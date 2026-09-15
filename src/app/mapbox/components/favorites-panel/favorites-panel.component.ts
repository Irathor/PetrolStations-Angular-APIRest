import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';

import { FavoritesService, MapService, ComparisonService } from '../../services';
import { FavoriteStation } from '../../services/map.service';
import { FUEL_PROPERTY, FuelKey } from '../../interfaces/fuel';
import { describeSchedule, ScheduleStatus } from '../../utils/schedule';
import { OilStationProperties } from '../../interfaces/oilstations';

interface FavoriteStationRow {
  id: string;
  name: string;
  address?: string;
  price?: number;
  distanceKm?: number;
  schedule: ScheduleStatus;
  station: FavoriteStation;
}

/**
 * Panel con el detalle de las gasolineras favoritas (nombre, precio del
 * combustible seleccionado, distancia y horario). Vive embebido en el menú
 * principal flotante (app-main-menu). Injecta los servicios directamente,
 * igual que ya hace app-search-results con MapService/GeolocationsService.
 */
@Component({
  selector: 'app-favorites-panel',
  templateUrl: './favorites-panel.component.html',
  styleUrls: ['./favorites-panel.component.css'],
  standalone: false
})
export class FavoritesPanelComponent implements OnInit, OnChanges, OnDestroy {

  /** Combustible actualmente seleccionado en la app: determina qué precio se muestra. */
  @Input() selectedCombustible: FuelKey = 'gasoleo_a';

  rows: FavoriteStationRow[] = [];

  private changesSubscription?: Subscription;
  private comparisonSubscription?: Subscription;

  constructor(
    private readonly mapService: MapService,
    private readonly favoritesService: FavoritesService,
    private readonly comparisonService: ComparisonService
  ) { }

  ngOnInit(): void {
    this.refresh();
    this.changesSubscription = this.favoritesService.changes$.subscribe(() => this.refresh());
    // Repinta para que el botón "Comparar" de cada fila refleje si esa
    // estación se ha añadido/quitado de la comparación desde otro sitio
    // (p.ej. desde el popup del mapa).
    this.comparisonSubscription = this.comparisonService.changes$.subscribe(() => this.refresh());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if(changes['selectedCombustible'] && !changes['selectedCombustible'].firstChange){
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.changesSubscription?.unsubscribe();
    this.comparisonSubscription?.unsubscribe();
  }

  /** id de la fila para la que se acaba de rechazar un intento de añadir a comparar (máximo alcanzado), para el feedback breve del botón. */
  limitReachedId?: string;

  isSelectedForComparison(id: string): boolean {
    return this.comparisonService.isSelected(id);
  }

  onToggleComparison(id: string){
    const changed = this.comparisonService.toggle(id);
    if(!changed){
      this.limitReachedId = id;
      setTimeout(() => {
        if(this.limitReachedId === id){
          this.limitReachedId = undefined;
        }
      }, 1500);
    }
  }

  private refresh(){
    const priceField = FUEL_PROPERTY[this.selectedCombustible] as keyof OilStationProperties;

    this.rows = this.mapService.getFavoriteStations()
      .map(station => ({
        id: station.feature.properties.id,
        name: station.feature.properties.Estacion ?? 'Gasolinera',
        address: station.feature.properties.Direccion,
        price: station.feature.properties[priceField] as number | undefined,
        distanceKm: station.distanceKm,
        schedule: describeSchedule(station.feature.properties.Horario),
        station
      }))
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name));
  }

  focusStation(row: FavoriteStationRow){
    const [lng, lat] = row.station.feature.geometry.coordinates;
    this.mapService.flyto([lng, lat]);
  }

}
