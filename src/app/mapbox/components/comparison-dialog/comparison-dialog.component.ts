import { Component, Input, OnChanges, OnDestroy, OnInit, SimpleChanges } from '@angular/core';
import { Subscription } from 'rxjs';

import { ComparisonService, MapService } from '../../services';
import { FUEL_OPTIONS, FUEL_PROPERTY, FuelKey } from '../../interfaces/fuel';
import { OilStationProperties } from '../../interfaces/oilstations';
import { describeSchedule, ScheduleStatus } from '../../utils/schedule';
import { sortByDistanceThenName } from '../../utils/geo';

export const MIN_STATIONS_TO_COMPARE = 2;

interface ComparisonColumn {
  id: string;
  name: string;
  address?: string;
  prices: Partial<Record<FuelKey, number>>;
  distanceKm?: number;
  schedule: ScheduleStatus;
  tripCost?: number;
}

/**
 * Tabla comparativa de las gasolineras seleccionadas en ComparisonService
 * (desde el mapa o desde favoritas): precio por combustible, distancia,
 * horario y coste de viaje estimado, destacando la opción más barata según
 * el combustible actualmente seleccionado en la app.
 */
@Component({
  selector: 'app-comparison-dialog',
  templateUrl: './comparison-dialog.component.html',
  styleUrls: ['./comparison-dialog.component.css'],
  standalone: false
})
export class ComparisonDialogComponent implements OnInit, OnChanges, OnDestroy {

  /** Combustible actualmente seleccionado en la app: determina qué columna se destaca como más barata. */
  @Input() selectedCombustible: FuelKey = 'gasoleo_a';

  readonly fuelOptions = FUEL_OPTIONS;
  readonly minStations = MIN_STATIONS_TO_COMPARE;

  columns: ComparisonColumn[] = [];
  tankCapacityLiters?: number;

  private changesSubscription?: Subscription;

  constructor(
    private readonly mapService: MapService,
    private readonly comparisonService: ComparisonService
  ) { }

  ngOnInit(): void {
    this.refresh();
    this.changesSubscription = this.comparisonService.changes$.subscribe(() => this.refresh());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if(changes['selectedCombustible'] && !changes['selectedCombustible'].firstChange){
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.changesSubscription?.unsubscribe();
  }

  get cheapestId(): string | undefined {
    let cheapestId: string | undefined;
    let cheapestPrice = Infinity;

    for(const column of this.columns){
      const price = column.prices[this.selectedCombustible];
      if(price != null && price < cheapestPrice){
        cheapestPrice = price;
        cheapestId = column.id;
      }
    }

    return cheapestId;
  }

  removeFromComparison(id: string){
    this.comparisonService.remove(id);
  }

  onTankCapacityChange(){
    this.refresh();
  }

  private refresh(){
    const ids = this.comparisonService.getAll();
    const stations = this.mapService.getStationsByIds(ids);

    this.columns = stations
      .map(station => {
        const prices: Partial<Record<FuelKey, number>> = {};
        for(const fuel of Object.keys(FUEL_PROPERTY) as FuelKey[]){
          const value = station.feature.properties[FUEL_PROPERTY[fuel] as keyof OilStationProperties] as number | undefined;
          if(value != null){
            prices[fuel] = value;
          }
        }

        const selectedPrice = prices[this.selectedCombustible];
        const tripCost = this.tankCapacityLiters && this.tankCapacityLiters > 0 && selectedPrice != null
          ? selectedPrice * this.tankCapacityLiters
          : undefined;

        return {
          id: station.feature.properties.id,
          name: station.feature.properties.Estacion ?? 'Gasolinera',
          address: station.feature.properties.Direccion,
          prices,
          distanceKm: station.distanceKm,
          schedule: describeSchedule(station.feature.properties.Horario),
          tripCost
        };
      })
      .sort(sortByDistanceThenName);
  }

}
