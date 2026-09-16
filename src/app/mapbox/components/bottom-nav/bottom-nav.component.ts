import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Bottom navigation de 6 accesos para móvil (Explorar / Cerca de mí /
 * Favoritas / Ruta / Filtros / Comparar) — en móvil no hay panel lateral
 * (EPIC-9), así que estas 6 acciones viven directamente aquí en vez de tras
 * un menú intermedio. Puramente presentacional: toda la lógica vive en
 * map-view.component (y en MapService para la ruta activa / ComparisonService
 * para el conteo de comparación).
 */
@Component({
  selector: 'app-bottom-nav',
  templateUrl: './bottom-nav.component.html',
  styleUrls: ['./bottom-nav.component.css'],
  standalone: false
})
export class BottomNavComponent {

  @Input() nearMeActive = false;
  @Input() favoritesOnly = false;
  @Input() hasActiveRoute = false;
  @Input() activeFiltersCount = 0;
  @Input() comparisonSelectionActive = false;
  @Input() comparisonCount = 0;

  @Output() explorar = new EventEmitter<void>();
  @Output() nearMeToggle = new EventEmitter<void>();
  @Output() favoritesOnlyToggle = new EventEmitter<void>();
  @Output() focusRoute = new EventEmitter<void>();
  @Output() openFilters = new EventEmitter<void>();
  @Output() toggleComparisonMode = new EventEmitter<void>();

}
