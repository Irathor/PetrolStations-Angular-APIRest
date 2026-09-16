import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FacetItem } from '../../interfaces/facets';
import { FUEL_OPTIONS, FuelKey } from '../../interfaces/fuel';
import { ComparisonService, GeolocationsService, MapService } from '../../services';

export const NEAR_ME_RADIUS_OPTIONS_KM = [2, 5, 10, 25, 50];

type PanelState = 'collapsed' | 'base' | 'section';
type SectionKey = 'nearMe' | 'favorites' | 'filters' | 'route';

/**
 * Panel lateral izquierdo, persistente (sustituye tanto al menú ☰ flotante
 * `app-main-menu` como a la app bar superior de escritorio, EPIC-10). Tres
 * estados: colapsado (solo el botón hamburguesa), base (cabecera con marca/
 * buscador/combustible + columna de botones icono+texto) y sección abierta
 * (el panel se ensancha y muestra el contenido de la sección pulsada
 * embebido en el mismo recuadro, en vez de un p-dialog/p-drawer aparte). El
 * botón hamburguesa siempre visible retrocede un nivel por pulsación:
 * sección → base → colapsado, y vuelve a expandir a base desde colapsado.
 *
 * Centrar mapa / cambiar estilo / buscar lugar se resuelven aquí mismo,
 * inyectando MapService/GeolocationsService directamente (mismo patrón que
 * ya usa este componente con ComparisonService, o app-favorites-panel/
 * app-route-planner): no aportan estado que map-view necesite conocer, así
 * que no hace falta subir esos eventos por @Output.
 *
 * Comparar no abre una sección propia: activa/desactiva directamente el
 * modo de selección en el mapa. Su contador/"Ver comparativa"/"Salir" ya
 * los cubre la barra flotante `.comparison-mode-bar`, que vive a nivel de
 * map-view (visible con independencia del estado de este panel) — abrir
 * también una sección aquí duplicaría esos mismos controles dos veces en
 * pantalla a la vez.
 *
 * Cerca de mí tampoco tiene un botón de activación aparte: el propio botón
 * de navegación activa/desactiva "cerca de mí" a la vez que abre/cierra su
 * sección (el radio de búsqueda) — un segundo botón interno para lo mismo
 * era redundante.
 */
@Component({
  selector: 'app-side-panel',
  templateUrl: './side-panel.component.html',
  styleUrls: ['./side-panel.component.css'],
  standalone: false
})
export class SidePanelComponent {

  @Input() nearMeActive = false;
  @Input() nearMeRadiusKm = 10;
  @Input() favoritesOnly = false;
  @Input() favoritesCount = 0;
  @Input() activeFiltersCount = 0;
  @Input() selectedCombustible: FuelKey = 'gasoleo_a';
  @Input() infoReady = false;

  @Input() provincias: FacetItem[] = [];
  @Input() estaciones: FacetItem[] = [];
  @Input() selectedProvincias: string[] = [];
  @Input() selectedEstaciones: string[] = [];
  @Input() selectedPrecios: number[] = [0, 3];
  @Input() precioMaximoSlider = 3;

  @Output() explorar = new EventEmitter<void>();
  @Output() nearMeToggle = new EventEmitter<void>();
  @Output() nearMeRadiusChange = new EventEmitter<number>();
  @Output() favoritesOnlyToggle = new EventEmitter<void>();
  @Output() provinciaChange = new EventEmitter<string[]>();
  @Output() estacionChange = new EventEmitter<string[]>();
  @Output() precioChange = new EventEmitter<number[]>();
  @Output() combustibleChange = new EventEmitter<FuelKey>();
  @Output() queryChanged = new EventEmitter<string>();

  readonly radiusOptions = NEAR_ME_RADIUS_OPTIONS_KM.map(km => ({ label: `${ km } km`, value: km }));
  readonly fuelOptions = FUEL_OPTIONS;

  panelState: PanelState = 'base';
  activeSection?: SectionKey;

  constructor(
    private readonly comparisonService: ComparisonService,
    private readonly geolocationsService: GeolocationsService,
    private readonly mapService: MapService
  ) { }

  get panelExpanded(): boolean {
    return this.panelState !== 'collapsed';
  }

  get comparisonCount(): number {
    return this.comparisonService.count;
  }

  get comparisonSelectionActive(): boolean {
    return this.comparisonService.isSelectionModeActive;
  }

  /** true si el mapa está en el estilo oscuro (el otro es el estilo "normal", con los colores clásicos de mapa). */
  get isDarkMap(): boolean {
    return this.mapService.currentStyleMode === 'dark';
  }

  /** Anuncio para lectores de pantalla del estado actual (aria-live), ver también aria-expanded en el botón hamburguesa. */
  get stateAnnouncement(): string {
    if(this.panelState === 'collapsed'){ return 'Panel de navegación colapsado'; }
    if(this.panelState === 'base'){ return 'Panel de navegación expandido'; }
    const labels: Record<SectionKey, string> = {
      nearMe: 'Cerca de mí', favorites: 'Favoritas', filters: 'Filtros', route: 'Planificar ruta'
    };
    return `Sección ${ labels[this.activeSection!] } abierta`;
  }

  /** Botón hamburguesa: retrocede un nivel (sección→base→colapsado); desde colapsado, vuelve a expandir a base. */
  toggleHamburger(){
    if(this.panelState === 'section'){
      this.activeSection = undefined;
      this.panelState = 'base';
    } else if(this.panelState === 'base'){
      this.panelState = 'collapsed';
    } else {
      this.panelState = 'base';
    }
  }

  /** Botones de sección: abren su contenido, o lo cierran (toggle) si ya estaba abierto. */
  selectSection(section: SectionKey){
    if(this.activeSection === section){
      this.activeSection = undefined;
      this.panelState = 'base';
    } else {
      this.activeSection = section;
      this.panelState = 'section';
    }
  }

  /** El botón "Cerca de mí" activa/desactiva la funcionalidad a la vez que abre/cierra su sección (el radio de búsqueda) — no hay un botón de activación aparte. */
  onNearMeClick(){
    this.nearMeToggle.emit();
    this.selectSection('nearMe');
  }

  onExplorar(){
    this.activeSection = undefined;
    this.panelState = 'base';
    this.explorar.emit();
  }

  onRadiusChange(event: { value?: number }){
    if(event.value != null){
      this.nearMeRadiusChange.emit(event.value);
    }
  }

  toggleComparisonMode(){
    this.comparisonService.setSelectionMode(!this.comparisonSelectionActive);
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

  toggleMapStyle(){
    this.mapService.toggleMapStyle();
  }

  onQueryChanged(query: string){
    this.queryChanged.emit(query);
  }

  onCombustibleChange(event: { value: FuelKey }){
    this.combustibleChange.emit(event.value);
  }

}
