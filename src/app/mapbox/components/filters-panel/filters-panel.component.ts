import { Component, EventEmitter, Input, Output } from '@angular/core';

import { FacetItem } from '../../interfaces/facets';

/**
 * Controles de filtro (provincia/marca/precio; el combustible vive en la app
 * bar, siempre visible). Puramente presentacional: el estado ya vive
 * acoplado a `applyFilters()`/`localStorage` en `map-view.component`, igual
 * que antes de extraer este componente. Se usa en dos sitios sin duplicar
 * plantilla: dentro del `p-drawer` de filtros (móvil) y dentro de la
 * sección "Filtros" de `app-side-panel` (desktop).
 */
@Component({
  selector: 'app-filters-panel',
  templateUrl: './filters-panel.component.html',
  styleUrls: ['./filters-panel.component.css'],
  standalone: false
})
export class FiltersPanelComponent {

  @Input() provincias: FacetItem[] = [];
  @Input() estaciones: FacetItem[] = [];
  @Input() selectedProvincias: string[] = [];
  @Input() selectedEstaciones: string[] = [];
  @Input() selectedPrecios: number[] = [0, 3];
  @Input() precioMaximoSlider = 3;

  @Output() provinciaChange = new EventEmitter<string[]>();
  @Output() estacionChange = new EventEmitter<string[]>();
  @Output() precioChange = new EventEmitter<number[]>();

  onProvinciaChange(event: { value: string[] }){
    this.provinciaChange.emit(event.value);
  }

  onEstacionChange(event: { value: string[] }){
    this.estacionChange.emit(event.value);
  }

  onPrecioSlideEnd(event: { values?: number[] }){
    if(event.values){
      this.precioChange.emit(event.values);
    }
  }

}
