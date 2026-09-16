import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { Subscription } from 'rxjs';

import { ComparisonService, FavoritesService, GeolocationsService, MapService } from '../../services';

import { FacetItem } from '../../interfaces/facets';
import { OilStationsFilter } from '../../interfaces/oilStationsFilter';
import { FUEL_OPTIONS, FuelKey } from '../../interfaces/fuel';
import { MIN_STATIONS_TO_COMPARE } from '../../components/comparison-dialog/comparison-dialog.component';

const DEFAULT_NEAR_ME_RADIUS_KM = 10;
const DEFAULT_PRECIO_RANGE: [number, number] = [0, 3];
const FILTERS_STORAGE_KEY = 'oil-stations:filtros';

// Por debajo de este ancho: drawer de filtros desde abajo, bottom navigation
// visible. Mismo umbral que ya usaba la barra de filtros apilada anterior.
const MOBILE_BREAKPOINT_PX = 900;

interface StoredFilters {
  provincias: string[];
  estaciones: string[];
  precio: number[];
  combustible: FuelKey;
  nearMeRadiusKm?: number;
}

@Component({
    selector: 'app-map-view',
    templateUrl: './map-view.component.html',
    styleUrls: ['./map-view.component.css'],
    standalone: false
})
export class MapViewComponent implements OnInit, OnDestroy {

  provincias: FacetItem[] = [];
  estaciones: FacetItem[] = [];
  fuelOptions = FUEL_OPTIONS;
  preciosMaximos: Partial<Record<FuelKey, number>> = {};
  readonly minStationsToCompare = MIN_STATIONS_TO_COMPARE;

  selectedProvincias: string[] = [];
  selectedEstaciones: string[] = [];
  selectedPrecios: number[] = [...DEFAULT_PRECIO_RANGE];
  selectedCombustible: FuelKey = 'gasoleo_a';

  public isLoadingOilStations: boolean = false;
  public noResults: boolean = false;

  public nearMeActive: boolean = false;
  public nearMeRadiusKm: number = DEFAULT_NEAR_ME_RADIUS_KM;
  public favoritesOnly: boolean = false;
  public favoritesCount: number = 0;

  public filtersDrawerVisible: boolean = false;
  public isMobileViewport: boolean = false;
  public hasActiveRoute: boolean = false;

  // Diálogo "Ver evolución de precios", abierto desde el popup de una
  // estación (DOM manual, no puede montar componentes Angular): MapService
  // dispara priceHistoryStationId vía el callback registrado más abajo.
  public priceHistoryVisible: boolean = false;
  public priceHistoryStationId?: string;

  /** Tabla comparativa (p-dialog), abierta desde la barra flotante de modo comparación (ver comparisonSelectionActive). */
  public comparisonVisible: boolean = false;

  private favoritesSubscription?: Subscription;
  private hasActiveRouteSubscription?: Subscription;

  private debounceTimer?: NodeJS.Timeout;
  public infoReady: boolean = false;

  constructor(
    private readonly geolocationsService: GeolocationsService,
    private readonly mapService: MapService,
    private readonly favoritesService: FavoritesService,
    private readonly comparisonService: ComparisonService
    ) { }

  ngOnInit(): void {

    this.updateIsMobileViewport();

    const stored = this.loadStoredFilters();
    this.selectedProvincias = stored.provincias ?? [];
    this.selectedEstaciones = stored.estaciones ?? [];
    this.selectedPrecios = stored.precio ?? [...DEFAULT_PRECIO_RANGE];
    this.selectedCombustible = stored.combustible ?? 'gasoleo_a';
    this.nearMeRadiusKm = stored.nearMeRadiusKm ?? DEFAULT_NEAR_ME_RADIUS_KM;
    this.mapService.setFuelField(this.selectedCombustible);

    this.favoritesCount = this.favoritesService.getAll().length;
    this.favoritesSubscription = this.favoritesService.changes$.subscribe(
      () => this.favoritesCount = this.favoritesService.getAll().length
    );

    this.hasActiveRouteSubscription = this.mapService.hasActiveRoute$.subscribe(
      active => this.hasActiveRoute = active
    );

    // El popup de estación es DOM manual (MapLibre, fuera del árbol de
    // Angular) y no puede abrir un p-dialog por sí mismo: delega en este
    // callback, mismo patrón que setDirectionsHandler/setUserLocationProvider.
    this.mapService.setPriceHistoryHandler(stationId => {
      this.priceHistoryStationId = stationId;
      this.priceHistoryVisible = true;
    });

    // Listas para los desplegables de filtro (siempre sobre el dataset completo).
    this.geolocationsService.getFacets().subscribe(facets => {
      this.provincias = facets.provincias;
      this.estaciones = facets.estaciones;
      this.preciosMaximos = facets.preciosMaximos ?? {};
    });

    // Con el clustering ya no hace falta esperar a que el usuario filtre:
    // se muestran todas las gasolineras desde el principio (respetando
    // los filtros recordados de la última visita, si los había).
    this.applyFilters();

  }

  ngOnDestroy(): void {
    this.favoritesSubscription?.unsubscribe();
    this.hasActiveRouteSubscription?.unsubscribe();
  }

  @HostListener('window:resize')
  updateIsMobileViewport(){
    this.isMobileViewport = typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT_PX;
  }

  /** Máximo real (redondeado hacia arriba) para el combustible seleccionado, o el máximo por defecto mientras no hay dato. */
  get precioMaximoSlider(): number {
    const max = this.preciosMaximos[this.selectedCombustible];
    return max !== undefined ? Math.ceil(max) : DEFAULT_PRECIO_RANGE[1];
  }

  get activeFiltersCount(): number {
    let count = 0;
    if(this.selectedProvincias.length > 0){ count++; }
    if(this.selectedEstaciones.length > 0){ count++; }
    if(this.selectedPrecios[0] !== DEFAULT_PRECIO_RANGE[0] || this.selectedPrecios[1] !== DEFAULT_PRECIO_RANGE[1]){ count++; }
    return count;
  }

  openFilters(){
    this.filtersDrawerVisible = true;
  }

  get comparisonCount(): number {
    return this.comparisonService.count;
  }

  get comparisonSelectionActive(): boolean {
    return this.comparisonService.isSelectionModeActive;
  }

  toggleComparisonSelectionMode(){
    this.comparisonService.setSelectionMode(!this.comparisonSelectionActive);
  }

  exitComparisonMode(){
    this.comparisonService.setSelectionMode(false);
  }

  openComparisonTable(){
    this.comparisonVisible = true;
  }

  /** Accedido desde el menú/bottom nav: vuelve a la vista general (sin "cerca de mí" ni "solo favoritas"). */
  explorar(){
    let changed = false;

    if(this.nearMeActive){
      this.nearMeActive = false;
      changed = true;
    }
    if(this.favoritesOnly){
      this.favoritesOnly = false;
      this.mapService.setFavoritesOnly(false);
      changed = true;
    }

    if(changed){
      this.applyFilters();
    }
  }

  changeNearMeRadius(radiusKm: number){
    this.nearMeRadiusKm = radiusKm;
    if(this.nearMeActive){
      this.applyFilters();
    }else{
      this.persistFilters();
    }
  }

  focusActiveRoute(){
    this.mapService.fitToActiveRoute();
  }

  get locationReady(){
    return this.geolocationsService.locationReady;
  }

  /** true si estamos mostrando Madrid por defecto porque no se pudo geolocalizar al usuario. */
  get usingDefaultLocation(){
    return this.geolocationsService.usingDefaultLocation;
  }

  centrarMapa(){
    if(!this.geolocationsService.locationReady){
      throw Error('No se ha podido Geolocalizar');
    }
    if(!this.mapService.isMapReady){
      throw Error('No hay mapa disponible');
    }
    this.mapService.flyto(this.geolocationsService.userLocation!);
  }

  toggleNearMe(){
    if(!this.geolocationsService.userLocation){
      throw Error('No se ha podido Geolocalizar');
    }

    this.nearMeActive = !this.nearMeActive;
    this.applyFilters();
  }

  /** true si el mapa está en el estilo oscuro (el otro es el estilo "normal", con los colores clásicos de mapa). */
  get isDarkMap(): boolean {
    return this.mapService.currentStyleMode === 'dark';
  }

  toggleMapStyle(){
    this.mapService.toggleMapStyle();
  }

  toggleFavoritesOnly(){
    this.favoritesOnly = !this.favoritesOnly;
    this.mapService.setFavoritesOnly(this.favoritesOnly);

    if(this.favoritesOnly){
      // Las favoritas deben verse aunque no encajen con los filtros activos
      // (provincia, precio...): se piden todas y MapService se encarga de
      // quedarse solo con las marcadas como favoritas.
      this.isLoadingOilStations = true;
      this.geolocationsService.getOilStations({}).subscribe(() => {
        this.isLoadingOilStations = false;
        this.noResults = this.favoritesCount === 0;
      });
    }else{
      this.applyFilters();
    }
  }

  onQueryChanged(query: string = ''){
    if(this.debounceTimer){
      clearTimeout(this.debounceTimer);
      this.infoReady = false;
    }

    this.debounceTimer = setTimeout(()=>{
      if(query !==''){
        this.infoReady = true;
      }
      this.geolocationsService.getPlacesByQuery(query);
    }, 350);

  }

  selectProvincia(provincias: string[]){
    this.applyFilters({ provincias });
  }

  selectEstacion(estaciones: string[]){
    this.applyFilters({ estaciones });
  }

  selectPrecio(precio: number[]){
    this.applyFilters({ precio });
  }

  selectCombustible(event: any){
    this.selectedCombustible = event.value;
    this.mapService.setFuelField(this.selectedCombustible);

    // La barra puede cambiar de máximo al cambiar de combustible: si el
    // extremo superior seleccionado ya no cabe en el nuevo rango, se ajusta.
    const nuevoMaximo = this.precioMaximoSlider;
    if(this.selectedPrecios[1] > nuevoMaximo){
      this.selectedPrecios = [this.selectedPrecios[0], nuevoMaximo];
    }

    this.applyFilters();
  }

  /** Reconstruye el filtro combinando provincia/estación/precio/combustible con "cerca de mí" (si está activo), lo aplica y lo recuerda. */
  private applyFilters(overrides: Partial<Pick<OilStationsFilter, 'provincias' | 'estaciones' | 'precio'>> = {}){
    this.selectedProvincias = overrides.provincias ?? this.selectedProvincias;
    this.selectedEstaciones = overrides.estaciones ?? this.selectedEstaciones;
    this.selectedPrecios = overrides.precio ?? this.selectedPrecios;

    const filter: OilStationsFilter = {
      provincias: this.selectedProvincias,
      estaciones: this.selectedEstaciones,
      precio: this.selectedPrecios,
      combustible: this.selectedCombustible,
    };

    if(this.nearMeActive && this.geolocationsService.userLocation){
      const [lon, lat] = this.geolocationsService.userLocation;
      filter.cercaDe = { lat, lon, radioKm: this.nearMeRadiusKm };
    }

    this.isLoadingOilStations = true;
    this.noResults = false;

    this.geolocationsService.getOilStations(filter).subscribe(collection => {
      this.isLoadingOilStations = false;
      this.noResults = collection.features.length === 0;
    });

    this.persistFilters();
  }

  private loadStoredFilters(): Partial<StoredFilters> {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      // localStorage puede no estar disponible (modo privado, cuota llena...); se empieza sin filtros guardados.
      return {};
    }
  }

  private persistFilters(){
    try {
      const toStore: StoredFilters = {
        provincias: this.selectedProvincias,
        estaciones: this.selectedEstaciones,
        precio: this.selectedPrecios,
        combustible: this.selectedCombustible,
        nearMeRadiusKm: this.nearMeRadiusKm,
      };
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // No es crítico: la sesión actual sigue funcionando aunque no se puedan recordar los filtros.
    }
  }

}
