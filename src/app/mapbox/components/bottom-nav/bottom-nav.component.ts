import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Bottom navigation de 4 accesos para móvil (Explorar / Cerca de mí /
 * Favoritas / Ruta), sustituye a la barra de filtros apilada que había antes
 * en ese viewport. Puramente presentacional: toda la lógica vive en
 * map-view.component (y en MapService para la ruta activa).
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

  @Output() explorar = new EventEmitter<void>();
  @Output() nearMeToggle = new EventEmitter<void>();
  @Output() favoritesOnlyToggle = new EventEmitter<void>();
  @Output() focusRoute = new EventEmitter<void>();

}
