import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FuelKey } from '../../interfaces/fuel';

export const NEAR_ME_RADIUS_OPTIONS_KM = [2, 5, 10, 25, 50];

/**
 * Menú principal flotante (se abre/cierra sobre un p-popover, no permanente):
 * Explorar, Cerca de mí (con radio configurable), Favoritas (con el panel de
 * detalle embebido) y Filtros (delega la apertura del drawer al padre).
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

}
