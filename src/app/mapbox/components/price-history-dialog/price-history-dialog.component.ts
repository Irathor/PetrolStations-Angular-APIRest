import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

import { PriceHistoryApiClient } from '../../api';
import { PriceHistoryEntry } from '../../interfaces/priceHistory';
import { FUEL_LABEL, FUEL_OPTIONS, FuelKey } from '../../interfaces/fuel';

interface PricePoint {
  /** ISO date (valid_from) de la versión del histórico que aportó este precio. */
  date: string;
  price: number;
}

/**
 * Contenido del diálogo "Ver evolución de precios" abierto desde el popup de
 * una estación (ver MapService.setPriceHistoryHandler). El combustible que
 * se representa es local a este diálogo (por defecto, el seleccionado en la
 * barra de la app) y cambiarlo aquí no afecta al resto de la aplicación.
 */
@Component({
  selector: 'app-price-history-dialog',
  templateUrl: './price-history-dialog.component.html',
  styleUrls: ['./price-history-dialog.component.css'],
  standalone: false
})
export class PriceHistoryDialogComponent implements OnChanges {

  /** Id de la estación cuyo histórico se muestra (recalcula el fetch en cada cambio). */
  @Input() stationId?: string;
  /** Combustible seleccionado en la barra de la app: solo se usa como valor inicial del selector local. */
  @Input() selectedCombustible: FuelKey = 'gasoleo_a';

  readonly fuelOptions = FUEL_OPTIONS;

  localFuel: FuelKey = 'gasoleo_a';

  isLoading = false;
  errorMessage?: string;
  private history: PriceHistoryEntry[] = [];

  /** Puntos con dato para el combustible actualmente seleccionado en el
   * diálogo, ya ordenados por fecha (el backend los devuelve ascendentes).
   * Se recalcula solo cuando cambian `history`/`localFuel` (ver
   * `_recomputePoints`), en vez de en cada ciclo de detección de cambios:
   * de la plantilla lo leen `hasDataForFuel`, `currentPoint`, `firstPoint`,
   * `minPrice`, `maxPrice` y `chartData`, así que como getter habría
   * repetido el mismo filter+map hasta 6 veces por ciclo. */
  points: PricePoint[] = [];

  constructor(private readonly priceHistoryApi: PriceHistoryApiClient) { }

  ngOnChanges(changes: SimpleChanges): void {
    if(changes['stationId']){
      this.localFuel = this.selectedCombustible;
      this.fetchHistory();
    }
  }

  onLocalFuelChange(){
    // Cambiar el combustible no requiere una nueva petición: ya tenemos todo
    // el histórico descargado, solo cambia qué claves de "precios" se leen.
    this._recomputePoints();
  }

  get fuelLabel(): string {
    return FUEL_LABEL[this.localFuel];
  }

  get hasAnyHistory(): boolean {
    return this.history.length > 0;
  }

  get hasDataForFuel(): boolean {
    return this.points.length > 0;
  }

  get currentPoint(): PricePoint | undefined {
    return this.points.at(-1);
  }

  get firstPoint(): PricePoint | undefined {
    return this.points[0];
  }

  get minPrice(): number | undefined {
    return this.points.length ? Math.min(...this.points.map(p => p.price)) : undefined;
  }

  get maxPrice(): number | undefined {
    return this.points.length ? Math.max(...this.points.map(p => p.price)) : undefined;
  }

  get daysSinceFirstPoint(): number | undefined {
    if(!this.firstPoint){
      return undefined;
    }
    const diffMs = Date.now() - new Date(this.firstPoint.date).getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  get chartData() {
    return {
      labels: this.points.map(p => new Date(p.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })),
      datasets: [
        {
          label: this.fuelLabel,
          data: this.points.map(p => p.price),
          borderColor: '#75bef8',
          backgroundColor: 'rgba(117, 190, 248, 0.2)',
          tension: 0.2,
          fill: true
        }
      ]
    };
  }

  readonly chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      y: {
        ticks: {
          callback: (value: number) => `${ value } €`
        }
      }
    }
  };

  private fetchHistory(){
    this.history = [];
    this._recomputePoints();
    this.errorMessage = undefined;

    if(!this.stationId){
      return;
    }

    this.isLoading = true;

    this.priceHistoryApi.getPriceHistory(this.stationId).subscribe({
      next: response => {
        this.isLoading = false;
        this.history = response.history;
        this._recomputePoints();
      },
      error: error => {
        this.isLoading = false;
        this.errorMessage = error?.status === 404
          ? 'No se ha encontrado esta estación.'
          : 'No se ha podido cargar el histórico de precios. Inténtalo de nuevo.';
      }
    });
  }

  private _recomputePoints(){
    this.points = this.history
      .filter(entry => this.localFuel in entry.precios)
      .map(entry => ({ date: entry.valid_from, price: entry.precios[this.localFuel] as number }));
  }

}
