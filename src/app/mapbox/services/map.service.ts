import { Injectable } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { BehaviorSubject, Observable, map } from 'rxjs';

import {
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LngLatBounds,
  LngLatLike,
  Map,
  MapLayerMouseEvent,
  Marker,
  Popup
} from 'maplibre-gl';
import { Feature } from '../interfaces/places';
import { DirectionsApiClient } from '../api';
import { Route } from '../interfaces/directions';
import { OilStationFeature, OilStationProperties, OilStationsCollection } from '../interfaces/oilstations';
import { FUEL_LABEL, FUEL_PROPERTY, FuelKey } from '../interfaces/fuel';
import { describeSchedule } from '../utils/schedule';
import { haversineKm } from '../utils/geo';
import { FavoritesService } from './favorites.service';
import { ComparisonService } from './comparison.service';

/** Estación ya resuelta con sus datos completos (favoritas y comparador reutilizan la misma forma). */
export interface FavoriteStation {
  feature: OilStationFeature;
  distanceKm?: number;
}

/** Gasolinera más barata encontrada cerca de una ruta, con el desvío que supone llegar a ella. */
export interface CheapestOnRouteResult {
  feature: OilStationFeature;
  price: number;
  detourKm: number;
}

/** Resultado de planRoute(): la ruta calculada por OSRM y, si se encontró, la estación más barata cerca de ella. */
export interface PlannedRouteResult {
  route: Route;
  cheapest?: CheapestOnRouteResult;
}

// Identificadores de la fuente/capas de gasolineras en el estilo del mapa.
const OIL_STATIONS_SOURCE = 'oil-stations';
const CLUSTERS_LAYER = 'oil-stations-clusters';
const CLUSTER_COUNT_LAYER = 'oil-stations-cluster-count';
const UNCLUSTERED_LAYER = 'oil-stations-unclustered';

const DEFAULT_FUEL: FuelKey = 'gasoleo_a';
/** Desvío máximo (km) admitido por defecto al buscar la más barata sobre una ruta: usado por el flujo "Cómo llegar" del popup; el planificador de ruta permite ajustarlo. */
export const ROUTE_BUFFER_KM = 2;

// Estilos gratuitos de OpenFreeMap (sin token ni registro): "dark" es el
// oscuro que se usaba hasta ahora, "liberty" es su estilo con los colores
// clásicos de mapa (el "modo normal" que se puede elegir desde el selector).
export const MAP_STYLE_DARK_URL = 'https://tiles.openfreemap.org/styles/dark';
export const MAP_STYLE_LIGHT_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type MapStyleMode = 'dark' | 'light';
const MAP_STYLE_STORAGE_KEY = 'oil-stations:estilo-mapa';

// Color por marca para los puntos individuales (mismo criterio que antes,
// ahora expresado como una expresión del estilo en vez de JS por marcador).
const BRAND_COLOR_MATCH: any[] = [
  'match', ['get', 'Estacion'],
  'REPSOL', '#03a9f4',
  'CAMPSA', '#e53935',
  'PETRONOR', '#1e88e5',
  'CEPSA', '#fb8c00',
  'SHELL', '#fdd835',
  'GALP', '#8e24aa',
  'BP', '#43a047',
  '#9e9e9e' // color por defecto para el resto de marcas
];

/** Suma/conteo por combustible acumulados por cluster (los 4 a la vez, es barato). */
function buildClusterProperties(): Record<string, any> {
  const properties: Record<string, any> = {};

  for (const fuel of Object.keys(FUEL_PROPERTY) as FuelKey[]) {
    const field = FUEL_PROPERTY[fuel];
    properties[`sum_${fuel}`] = ['+', ['case', ['has', field], ['get', field], 0], ['accumulated']];
    properties[`count_${fuel}`] = ['+', ['case', ['has', field], 1, 0], ['accumulated']];
  }

  return properties;
}

/** "42 · 1.75€" con el precio medio del combustible seleccionado, o solo el conteo si el cluster no tiene datos de ese combustible. */
function buildClusterLabelExpression(fuel: FuelKey): any[] {
  const sumKey = `sum_${fuel}`;
  const countKey = `count_${fuel}`;
  const average = ['/', ['get', sumKey], ['max', ['get', countKey], 1]];
  const rounded = ['/', ['round', ['*', average, 100]], 100];

  return [
    'case',
    ['>', ['get', countKey], 0],
    ['concat', ['get', 'point_count_abbreviated'], ' · ', ['to-string', rounded], '€'],
    ['to-string', ['get', 'point_count_abbreviated']]
  ];
}

@Injectable({
  providedIn: 'root'
})
export class MapService {

  private map?: Map;
  private markers: Marker[] = [];
  private stationPopup?: Popup;
  private cheapestOnRouteMarker?: Marker;

  private selectedFuel: FuelKey = DEFAULT_FUEL;
  private favoritesOnly = false;

  // Última colección recibida de la API (sin filtrar por favoritas), y la
  // que realmente está pintada en el mapa (esa sí, filtrada si "solo
  // favoritas" está activo) — la ruta más barata busca sobre esta última.
  private latestFetchedCollection?: OilStationsCollection;
  private renderedOilStations?: OilStationsCollection;

  // Las gasolineras pueden llegar de la API antes de que el mapa exista
  // (la geolocalización es asíncrona y puede tardar más que la petición al
  // backend). Se guarda aquí el último dato a renderizar y se aplica en
  // cuanto el mapa y sus capas estén listos, en vez de perderlo o lanzar un error.
  private pendingOilStations?: OilStationsCollection;

  // GeolocationsService lo rellena (conoce la posición del usuario); así el
  // popup puede pedir una ruta sin que MapService dependa de GeolocationsService
  // (evita una dependencia circular entre ambos servicios).
  private directionsRequestHandler?: (destination: [number, number]) => void;

  // Mismo patrón que directionsRequestHandler: GeolocationsService registra
  // aquí cómo obtener la ubicación actual del usuario, para que el popup
  // pueda mostrar la distancia sin crear una dependencia circular.
  private userLocationProvider?: () => [number, number] | undefined;

  // Igual que directionsRequestHandler: el popup es DOM manual y no puede
  // abrir un p-dialog de Angular por sí mismo, así que delega en un callback
  // registrado por MapViewComponent (setPriceHistoryHandler), que sí puede
  // pilotar el diálogo de evolución de precios.
  private priceHistoryRequestHandler?: (stationId: string) => void;

  private lastRouteBounds?: LngLatBounds;
  private readonly hasActiveRouteSubject = new BehaviorSubject<boolean>(false);
  /** Emite true/false según haya o no una ruta dibujada actualmente en el mapa. */
  readonly hasActiveRoute$: Observable<boolean> = this.hasActiveRouteSubject.asObservable();

  private styleMode: MapStyleMode = this.loadStoredStyleMode();

  get isMapReady(){
    return !!this.map;
  }

  /** URL de estilo con la que crear el mapa (map.component.ts), respetando la preferencia guardada. */
  get initialStyleUrl(): string {
    return this.styleMode === 'light' ? MAP_STYLE_LIGHT_URL : MAP_STYLE_DARK_URL;
  }

  get currentStyleMode(): MapStyleMode {
    return this.styleMode;
  }

  constructor(
    private readonly directionsApi: DirectionsApiClient,
    private readonly currencyPipe: CurrencyPipe,
    private readonly favoritesService: FavoritesService,
    private readonly comparisonService: ComparisonService
    ){}

  /** Combustible actualmente usado para colorear clusters y buscar la más barata en ruta (lo lee el planificador como valor por defecto de su formulario). */
  get selectedFuelKey(): FuelKey {
    return this.selectedFuel;
  }

  setMap(map: Map){
    this.map = map;
    this.map.on('load', () => {
      this.setupOilStationsLayers();
      if(this.pendingOilStations){
        this.applyOilStations(this.pendingOilStations);
      }
    });
  }

  /** Alterna entre el estilo oscuro y el estilo "normal" del mapa, y recuerda la elección. */
  toggleMapStyle(){
    this.styleMode = this.styleMode === 'dark' ? 'light' : 'dark';

    try {
      localStorage.setItem(MAP_STYLE_STORAGE_KEY, this.styleMode);
    } catch {
      // No es crítico: simplemente no se recordará la preferencia entre visitas.
    }

    if(!this.map){
      return;
    }

    this.map.setStyle(this.initialStyleUrl);

    // setStyle() sustituye el estilo entero, así que borra la fuente y las
    // capas de gasolineras: hay que volver a registrarlas y repintar los
    // datos ya cargados en cuanto el nuevo estilo termine de cargar. La ruta
    // dibujada (si la había) se pierde igual que las capas del estilo
    // anterior; no merece la pena reconstruirla solo por un cambio de tema.
    this.map.once('style.load', () => {
      this.setupOilStationsLayers();
      if(this.renderedOilStations){
        this.applyOilStations(this.renderedOilStations);
      }
      this.cheapestOnRouteMarker?.remove();
      this.cheapestOnRouteMarker = undefined;
      // setStyle() se ha llevado por delante la capa/fuente de la ruta dibujada
      // (si la había): no se reconstruye, así que deja de haber ruta activa.
      this.lastRouteBounds = undefined;
      this.hasActiveRouteSubject.next(false);
    });
  }

  private loadStoredStyleMode(): MapStyleMode {
    try {
      return localStorage.getItem(MAP_STYLE_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  setDirectionsHandler(handler: (destination: [number, number]) => void){
    this.directionsRequestHandler = handler;
  }

  setUserLocationProvider(provider: () => [number, number] | undefined){
    this.userLocationProvider = provider;
  }

  setPriceHistoryHandler(handler: (stationId: string) => void){
    this.priceHistoryRequestHandler = handler;
  }

  /** Estaciones favoritas (entre las últimas recibidas de la API) con su distancia al usuario, si se conoce. */
  getFavoriteStations(): FavoriteStation[] {
    if(!this.latestFetchedCollection){
      return [];
    }

    const userLocation = this.userLocationProvider?.();

    return this.latestFetchedCollection.features
      .filter(feature => this.favoritesService.isFavorite(feature.properties.id))
      .map(feature => ({
        feature,
        distanceKm: userLocation ? haversineKm(userLocation, feature.geometry.coordinates) : undefined
      }));
  }

  /** Estaciones indicadas por id (entre las últimas recibidas de la API), con su distancia al usuario si se conoce. Usado por el comparador; ignora ids que ya no estén en el dataset actual. */
  getStationsByIds(ids: string[]): FavoriteStation[] {
    if(!this.latestFetchedCollection || ids.length === 0){
      return [];
    }

    const idSet = new Set(ids);
    const userLocation = this.userLocationProvider?.();

    return this.latestFetchedCollection.features
      .filter(feature => idSet.has(feature.properties.id))
      .map(feature => ({
        feature,
        distanceKm: userLocation ? haversineKm(userLocation, feature.geometry.coordinates) : undefined
      }));
  }

  /**
   * Precio medio del combustible indicado entre las gasolineras actualmente
   * pintadas en el mapa. Se usa como referencia para estimar el ahorro del
   * planificador de ruta (no hay una única "otra gasolinera" con la que
   * comparar, así que se usa la media del dataset visible como aproximación
   * razonable de "lo que pagarías si no hicieras el desvío").
   */
  getAveragePrice(fuel: FuelKey): number | undefined {
    if(!this.renderedOilStations){
      return undefined;
    }

    const field = FUEL_PROPERTY[fuel] as keyof OilStationProperties;
    const prices = this.renderedOilStations.features
      .map(feature => feature.properties[field] as number | undefined)
      .filter((price): price is number => price != null);

    if(prices.length === 0){
      return undefined;
    }

    return prices.reduce((sum, price) => sum + price, 0) / prices.length;
  }

  /** Reencuadra el mapa sobre la última ruta dibujada. Devuelve false si no hay ninguna ruta activa. */
  fitToActiveRoute(): boolean {
    if(!this.map || !this.lastRouteBounds){
      return false;
    }

    this.map.fitBounds(this.lastRouteBounds, { padding: 200 });
    return true;
  }

  flyto(coords:LngLatLike){
    if (!this.isMapReady){
      throw Error('No se ha iniciado el mapa');
    }

    this.map?.flyTo({
      zoom: 14,
      center: coords
    });
  }

  createMarkersFromPlaces(places: Feature[], userLocation: [number, number]){
    if(!this.map){
      throw Error('Mapa no disponible');
    }

    this.markers.forEach(marker => marker.remove());
    const newMarkers = [];

    for(const place of places) {
      const [ lng, lat ] = place.center;
      const popup = new Popup()
              .setHTML(`
                <h6>${ place.text }</h6>
                <span>${ place.place_name }</span>
              `);

      const newMarker = new Marker()
              .setLngLat([lng, lat])
              .setPopup(popup)
              .addTo(this.map);

      newMarkers.push(newMarker);
    }

    this.markers = newMarkers;

    if(places.length === 0) {
      return;
    }

    // Adecuar el mapa a los lugares encontrados
    const bounds = new LngLatBounds();
    newMarkers.forEach(marker => bounds.extend(marker.getLngLat()));
    bounds.extend(userLocation);

    this.map.fitBounds(bounds, {
      padding: 200
    })
  }

  /**
   * Registra la fuente GeoJSON y las capas de clustering de gasolineras.
   * Se llama una vez, al cargar el estilo del mapa; setOilStations() solo
   * actualiza los datos de la fuente a partir de ahí.
   */
  private setupOilStationsLayers(){
    if(!this.map){
      return;
    }

    const oilStationsSource: GeoJSONSourceSpecification = {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
      clusterProperties: buildClusterProperties()
    };
    this.map.addSource(OIL_STATIONS_SOURCE, oilStationsSource);

    // Burbujas de cluster: tamaño y color crecen con el nº de gasolineras agrupadas.
    this.map.addLayer({
      id: CLUSTERS_LAYER,
      type: 'circle',
      source: OIL_STATIONS_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#51bbd6', 50,
          '#f1a13a', 200,
          '#f2543a'
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          16, 50,
          22, 200,
          28
        ],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff'
      }
    });

    this.map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: OIL_STATIONS_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': buildClusterLabelExpression(this.selectedFuel) as any,
        // Fuente del propio estilo de OpenFreeMap: sin esto, MapLibre usa un
        // fallback por defecto que ese servidor de glifos no tiene (404 en consola).
        'text-font': ['Noto Sans Bold'],
        'text-size': 12
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    // Gasolineras individuales, coloreadas por marca.
    this.map.addLayer({
      id: UNCLUSTERED_LAYER,
      type: 'circle',
      source: OIL_STATIONS_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': BRAND_COLOR_MATCH as any,
        'circle-radius': 7,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff'
      }
    });

    this.map.on('click', CLUSTERS_LAYER, (e) => this.onClusterClick(e));
    this.map.on('click', UNCLUSTERED_LAYER, (e) => this.onStationClick(e));

    for (const layer of [CLUSTERS_LAYER, UNCLUSTERED_LAYER]) {
      this.map.on('mouseenter', layer, () => this.setCursor('pointer'));
      this.map.on('mouseleave', layer, () => this.setCursor(''));
    }
  }

  private setCursor(cursor: string){
    if(this.map){
      this.map.getCanvas().style.cursor = cursor;
    }
  }

  /** Cambia el combustible usado para el precio medio de los clusters y la ruta más barata. */
  setFuelField(fuel: FuelKey){
    this.selectedFuel = fuel;

    if(this.map?.getLayer(CLUSTER_COUNT_LAYER)){
      this.map.setLayoutProperty(CLUSTER_COUNT_LAYER, 'text-field', buildClusterLabelExpression(fuel) as any);
    }
  }

  /** Muestra solo las gasolineras favoritas (entre las últimas recibidas de la API), o todas de nuevo. */
  setFavoritesOnly(active: boolean){
    this.favoritesOnly = active;
    this.renderCurrentSelection();
  }

  /** Reemplaza los datos de la fuente de gasolineras (llamado tras cada búsqueda/filtro). */
  setOilStations(collection: OilStationsCollection){
    this.latestFetchedCollection = collection;
    this.renderCurrentSelection();
  }

  private renderCurrentSelection(){
    if(!this.latestFetchedCollection){
      return;
    }

    const collection = this.favoritesOnly
      ? {
          type: 'FeatureCollection' as const,
          features: this.latestFetchedCollection.features.filter(f => this.favoritesService.isFavorite(f.properties.id))
        }
      : this.latestFetchedCollection;

    this.applyOilStations(collection);
  }

  private applyOilStations(collection: OilStationsCollection){
    const source = this.map?.getSource(OIL_STATIONS_SOURCE) as GeoJSONSource | undefined;

    if(!source){
      // El mapa (o sus capas) todavía no están listos: se aplicará en
      // cuanto termine de cargar, ver setMap().
      this.pendingOilStations = collection;
      return;
    }

    this.pendingOilStations = undefined;
    this.renderedOilStations = collection;
    source.setData(collection as any);
  }

  private onClusterClick(e: MapLayerMouseEvent){
    const feature = e.features?.[0];
    const clusterId = feature?.properties?.['cluster_id'];
    if(!this.map || !feature || clusterId == null){
      return;
    }

    const source = this.map.getSource(OIL_STATIONS_SOURCE) as GeoJSONSource;
    source.getClusterExpansionZoom(clusterId).then(zoom => {
      this.map?.easeTo({
        center: (feature.geometry as GeoJSON.Point).coordinates as LngLatLike,
        zoom
      });
    }).catch(() => {});
  }

  private onStationClick(e: MapLayerMouseEvent){
    const feature = e.features?.[0];
    if(!this.map || !feature){
      return;
    }

    const props = feature.properties as OilStationProperties;
    const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;

    this.stationPopup?.remove();
    this.stationPopup = new Popup()
      .setLngLat([lng, lat])
      .setDOMContent(this.buildStationPopupElement(props, [lng, lat]))
      .addTo(this.map);
  }

  /**
   * Contenido del popup de una gasolinera: favorito, horario, precios (con
   * el combustible seleccionado destacado) y un botón para pedir ruta hasta
   * allí. Se construye como elementos DOM reales (no HTML en string) para
   * poder engancharle listeners de clic sin depender de Angular dentro del popup.
   */
  private buildStationPopupElement(props: OilStationProperties, destination: [number, number]): HTMLElement {
    // Construido con document.createElement (no una plantilla Angular): MapLibre
    // monta el popup fuera del árbol de componentes de Angular. Las clases usadas
    // aquí (.station-popup*) son globales, definidas en src/styles.css, con los
    // mismos tokens de color que el resto de la app.
    const container = document.createElement('div');
    container.className = 'station-popup';

    const header = document.createElement('div');
    header.className = 'station-popup__header';

    const title = document.createElement('h6');
    title.className = 'station-popup__title';
    title.textContent = props.Estacion ?? '';

    const favoriteBtn = document.createElement('button');
    favoriteBtn.type = 'button';
    favoriteBtn.className = 'station-popup__favorite-btn';

    const applyStar = (isFavorite: boolean) => {
      favoriteBtn.textContent = isFavorite ? '★' : '☆';
      favoriteBtn.classList.toggle('is-favorite', isFavorite);
      favoriteBtn.setAttribute('aria-pressed', String(isFavorite));
      favoriteBtn.setAttribute('aria-label', isFavorite ? 'Quitar de favoritas' : 'Marcar como favorita');
    };
    applyStar(this.favoritesService.isFavorite(props.id));

    favoriteBtn.addEventListener('click', () => applyStar(this.favoritesService.toggle(props.id)));

    header.append(title, favoriteBtn);
    container.appendChild(header);

    if(props.Direccion){
      const address = document.createElement('span');
      address.className = 'station-popup__address';
      address.textContent = props.Direccion;
      container.appendChild(address);
    }

    const schedule = describeSchedule(props.Horario);
    const badge = document.createElement('span');
    badge.className = 'station-popup__badge';
    if(schedule.isOpenNow !== undefined){
      badge.classList.add(schedule.isOpenNow ? 'is-open' : 'is-closed');
    }
    badge.textContent = schedule.label;
    container.appendChild(badge);

    const userLocation = this.userLocationProvider?.();
    if(userLocation){
      const distance = document.createElement('span');
      distance.className = 'station-popup__distance';
      distance.textContent = `${ haversineKm(userLocation, destination).toFixed(1) } km`;
      container.appendChild(distance);
    }

    const selectedFuelPrice = props[FUEL_PROPERTY[this.selectedFuel] as keyof OilStationProperties] as number | undefined;
    if(selectedFuelPrice != null){
      const highlightedPrice = document.createElement('div');
      highlightedPrice.className = 'station-popup__price';
      highlightedPrice.innerHTML = `${ this.currencyPipe.transform(selectedFuelPrice, 'EUR') }<small>${ FUEL_LABEL[this.selectedFuel] }</small>`;
      container.appendChild(highlightedPrice);
    }

    const priceLines: Array<[FuelKey, string]> = [
      ['gasoleo_a', 'Gasóleo A'],
      ['gasoleo_premium', 'Gasóleo Premium'],
      ['gasolina_95', 'Gasolina 95'],
      ['gasolina_98', 'Gasolina 98']
    ];

    const priceList = document.createElement('div');
    priceList.className = 'station-popup__price-list';
    for(const [fuel, label] of priceLines){
      // El precio del combustible seleccionado ya se muestra destacado arriba.
      if(fuel === this.selectedFuel){
        continue;
      }
      const price = props[FUEL_PROPERTY[fuel] as keyof OilStationProperties] as number | undefined;
      if(price == null){
        continue;
      }
      const line = document.createElement('span');
      line.textContent = `${ label }: ${ this.currencyPipe.transform(price, 'EUR') }`;
      priceList.appendChild(line);
    }
    container.appendChild(priceList);

    const compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'station-popup__compare-btn';

    const applyCompareState = (isSelected: boolean) => {
      compareBtn.textContent = isSelected ? '✓ Comparando' : '+ Comparar';
      compareBtn.classList.toggle('is-selected', isSelected);
      compareBtn.setAttribute('aria-pressed', String(isSelected));
      compareBtn.setAttribute('aria-label', isSelected ? 'Quitar de la comparación' : 'Añadir a la comparación');
    };
    applyCompareState(this.comparisonService.isSelected(props.id));

    compareBtn.addEventListener('click', () => {
      const changed = this.comparisonService.toggle(props.id);
      if(!changed){
        // Límite de estaciones alcanzado: feedback breve y accesible (aria-live)
        // en vez de un toast que no existe en la app todavía.
        compareBtn.textContent = 'Máximo 4 estaciones';
        compareBtn.setAttribute('aria-live', 'polite');
        setTimeout(() => applyCompareState(this.comparisonService.isSelected(props.id)), 1500);
        return;
      }
      applyCompareState(this.comparisonService.isSelected(props.id));
    });
    container.appendChild(compareBtn);

    if(this.priceHistoryRequestHandler){
      const historyBtn = document.createElement('button');
      historyBtn.type = 'button';
      historyBtn.textContent = 'Ver evolución de precios';
      historyBtn.className = 'station-popup__history-btn';
      historyBtn.setAttribute('aria-label', `Ver evolución de precios de ${ props.Estacion ?? 'esta gasolinera' }`);
      historyBtn.addEventListener('click', () => {
        this.priceHistoryRequestHandler?.(props.id);
        this.stationPopup?.remove();
      });
      container.appendChild(historyBtn);
    }

    if(this.directionsRequestHandler){
      const directionsBtn = document.createElement('button');
      directionsBtn.type = 'button';
      directionsBtn.textContent = 'Cómo llegar';
      directionsBtn.className = 'directions-btn';
      directionsBtn.addEventListener('click', () => {
        this.directionsRequestHandler?.(destination);
        this.stationPopup?.remove();
      });
      container.appendChild(directionsBtn);
    }

    return container;
  }

  getRoutBetweenPoints(start: [number, number], end: [number, number]){
    this.directionsApi.getRoute(start, end)
      .subscribe(resp => this.drawPolyline(resp.routes[0]));
  }

  /**
   * Pide la ruta a OSRM, la dibuja en el mapa (mismo drawPolyline que usa el
   * botón "Cómo llegar" del popup) y busca la estación más barata a menos de
   * bufferKm de la ruta para el combustible indicado. A diferencia de
   * getRoutBetweenPoints(), devuelve los datos encontrados (no solo pinta el
   * mapa) para que el planificador de ruta los muestre en su propio panel.
   */
  planRoute(start: [number, number], end: [number, number], fuel: FuelKey, bufferKm: number = ROUTE_BUFFER_KM): Observable<PlannedRouteResult> {
    return this.directionsApi.getRoute(start, end).pipe(
      map(resp => {
        const route = resp.routes[0];
        this.drawPolyline(route, fuel, bufferKm);
        return {
          route,
          cheapest: this.findCheapestNearRoute(route.geometry.coordinates, bufferKm, fuel)
        };
      })
    );
  }

  private drawPolyline(route: Route, fuel: FuelKey = this.selectedFuel, bufferKm: number = ROUTE_BUFFER_KM){
    if(!this.map){
      throw Error('No hay mapa disponible');
    }

    const coords = route.geometry.coordinates;
    const bounds = new LngLatBounds();

    coords.forEach(([lng, lat]) => {
      bounds.extend([lng, lat]);
    })

    this.map?.fitBounds(bounds, {
      padding:200
    });

    this.lastRouteBounds = bounds;
    this.hasActiveRouteSubject.next(true);

    // Polyline (google maps) Linestring (MapLibre)
    const sourceData: GeoJSONSourceSpecification = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coords
            }
          }
        ]
      },
      maxzoom: 12,
      buffer: 0
    }

    // Para evitar el error a la hora de cambiar de ruta por el ID hay que limpiar ruta previa seleccionada
    if(this.map.getLayer('RouteString')){
      this.map.removeLayer('RouteString');
      this.map.removeSource('RouteString');
    }

    this.map.addSource('RouteString', sourceData);

    this.map.addLayer({
      id: 'RouteString',
      type: 'line',
      source: 'RouteString',
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': 'orange',
        'line-width': 3
      }
    });

    this.highlightCheapestOnRoute(coords, bufferKm, fuel);
  }

  /**
   * Busca, entre las gasolineras actualmente pintadas en el mapa, la más
   * barata (según el combustible seleccionado) a menos de ROUTE_BUFFER_KM de
   * la ruta dibujada, y la marca con un pin distinto. Delegado a
   * findCheapestNearRoute(); esto solo se encarga del marker/popup del mapa.
   */
  private highlightCheapestOnRoute(routeCoords: number[][], bufferKm: number = ROUTE_BUFFER_KM, fuel: FuelKey = this.selectedFuel){
    this.cheapestOnRouteMarker?.remove();
    this.cheapestOnRouteMarker = undefined;

    if(!this.map){
      return;
    }

    const result = this.findCheapestNearRoute(routeCoords, bufferKm, fuel);
    if(!result){
      return;
    }

    const [lng, lat] = result.feature.geometry.coordinates;
    const popup = new Popup({ closeButton: false })
      .setHTML(`
        <div style="text-align: center">
          <strong>Más barata en tu ruta</strong><br>
          ${ result.feature.properties.Estacion ?? '' }<br>
          ${ FUEL_LABEL[fuel] }: ${ this.currencyPipe.transform(result.price, 'EUR') }
        </div>
      `);

    this.cheapestOnRouteMarker = new Marker({ color: '#fdd835' })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(this.map);
  }

  /**
   * Busca, entre las gasolineras actualmente pintadas en el mapa, la más
   * barata (según el combustible indicado) a menos de bufferKm de la ruta,
   * y devuelve sus datos (sin tocar el mapa). Usa la distancia al vértice de
   * ruta más cercano como aproximación del desvío (las rutas de OSRM traen
   * suficientes puntos intermedios para que sea representativo, sin tener
   * que proyectar sobre cada segmento).
   */
  private findCheapestNearRoute(routeCoords: number[][], bufferKm: number, fuel: FuelKey): CheapestOnRouteResult | undefined {
    if(!this.renderedOilStations || routeCoords.length === 0){
      return undefined;
    }

    const fuelField = FUEL_PROPERTY[fuel] as keyof OilStationProperties;

    const routeBounds = new LngLatBounds();
    routeCoords.forEach(coord => routeBounds.extend(coord as [number, number]));
    const searchBounds = this.padBounds(routeBounds, bufferKm);

    let cheapest: OilStationFeature | undefined;
    let cheapestPrice = Infinity;
    let cheapestDetourKm = Infinity;

    for(const feature of this.renderedOilStations.features){
      const price = feature.properties[fuelField] as number | undefined;
      if(price == null || price >= cheapestPrice){
        continue;
      }

      const [lng, lat] = feature.geometry.coordinates;
      if(!searchBounds.contains([lng, lat])){
        continue;
      }

      const nearestDistanceKm = routeCoords.reduce(
        (min, coord) => Math.min(min, haversineKm(coord, [lng, lat])),
        Infinity
      );
      if(nearestDistanceKm > bufferKm){
        continue;
      }

      cheapest = feature;
      cheapestPrice = price;
      cheapestDetourKm = nearestDistanceKm;
    }

    if(!cheapest){
      return undefined;
    }

    return { feature: cheapest, price: cheapestPrice, detourKm: cheapestDetourKm };
  }

  private padBounds(bounds: LngLatBounds, km: number): LngLatBounds {
    const latPad = km / 111;
    const centerLat = bounds.getCenter().lat;
    const lonPad = km / (111 * Math.cos(centerLat * Math.PI / 180) || 1);

    return new LngLatBounds(
      [bounds.getWest() - lonPad, bounds.getSouth() - latPad],
      [bounds.getEast() + lonPad, bounds.getNorth() + latPad]
    );
  }

}
