import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FuelKey } from '../../interfaces/fuel';
import { ComparisonService } from '../../services';

export const NEAR_ME_RADIUS_OPTIONS_KM = [2, 5, 10, 25, 50];

/**
 * Menú principal flotante (se abre/cierra sobre un p-popover, no permanente):
 * Explorar, Cerca de mí (con radio configurable), Favoritas (con el panel de
 * detalle embebido), Filtros (delega la apertura del drawer al padre),
 * Planificar ruta y Comparar (ambos en su propio p-dialog, por la cantidad
 * de contenido que tienen: no caben cómodamente en el popover).
 */
@Component({
  selector: 'app-main-menu',
  templateUrl: './main-menu.component.html',
  styleUrls: ['./main-menu.component.css'],
  standalone: false
})
export class MainMenuComponent {

  @Input() nearMeActive = false;
  @Input() nearMeRadiusKm = 10;
  @Input() favoritesOnly = false;
  @Input() favoritesCount = 0;
  @Input() activeFiltersCount = 0;
  @Input() selectedCombustible: FuelKey = 'gasoleo_a';

  @Output() explorar = new EventEmitter<void>();
  @Output() nearMeToggle = new EventEmitter<void>();
  @Output() nearMeRadiusChange = new EventEmitter<number>();
  @Output() favoritesOnlyToggle = new EventEmitter<void>();
  @Output() openFilters = new EventEmitter<void>();

  readonly radiusOptions = NEAR_ME_RADIUS_OPTIONS_KM.map(km => ({ label: `${ km } km`, value: km }));

  favoritesExpanded = false;
  popoverVisible = false;
  routePlannerVisible = false;
  comparisonVisible = false;

  constructor(private readonly comparisonService: ComparisonService) { }

  /** Cuántas gasolineras hay seleccionadas para comparar (badge del menú).
   * Se lee directamente de `ComparisonService.count` en cada ciclo de
   * detección de cambios — no hace falta duplicarlo en un campo propio ni
   * suscribirse a `changes$` solo para mantenerlo sincronizado. */
  get comparisonCount(): number {
    return this.comparisonService.count;
  }

  onExplorar(){
    this.favoritesExpanded = false;
    this.explorar.emit();
  }

  onRadiusChange(event: { value?: number }){
    if(event.value != null){
      this.nearMeRadiusChange.emit(event.value);
    }
  }

  onFilters(){
    this.favoritesExpanded = false;
    this.openFilters.emit();
  }

  onOpenRoutePlanner(){
    this.favoritesExpanded = false;
    this.routePlannerVisible = true;
  }

  onOpenComparison(){
    this.favoritesExpanded = false;
    this.comparisonVisible = true;
  }

}
