import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';

import { FavoritesService, MapService } from '../../services';
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

  constructor(
    private readonly mapService: MapService,
    private readonly favoritesService: FavoritesService
  ) { }

  ngOnInit(): void {
    this.refresh();
    this.changesSubscription = this.favoritesService.changes$.subscribe(() => this.refresh());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if(changes['selectedCombustible'] && !changes['selectedCombustible'].firstChange){
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.changesSubscription?.unsubscribe();
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
