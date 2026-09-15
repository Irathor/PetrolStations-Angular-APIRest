import { Component, OnDestroy, OnInit } from '@angular/core';

import { Feature } from '../../interfaces/places';
import { FUEL_OPTIONS, FuelKey } from '../../interfaces/fuel';
import { MapService, GeolocationsService } from '../../services';
import { CheapestOnRouteResult, ROUTE_BUFFER_KM } from '../../services/map.service';
import { PlacesApiClient } from '../../api';

// Asunción: consumo medio de 7 L/100km para convertir el desvío (ida y
// vuelta hasta la gasolinera y de regreso a la ruta) en litros extra
// consumidos. No es un dato real del vehículo del usuario -no se pide ese
// dato en el formulario-, solo una estimación razonable para poder incluir
// el coste del desvío en el ahorro, como pide el criterio de la Epic.
export const ASSUMED_CONSUMPTION_L_PER_100KM = 7;

interface PlannerResult {
  stationName: string;
  address?: string;
  price: number;
  fuelLabel: string;
  detourKm: number;
  /** undefined si no se informó capacidad de depósito: en ese caso solo se muestra precio/desvío, sin ahorro. */
  savingsEstimate?: number;
}

/**
 * Formulario del planificador de ruta avanzado: origen/destino (buscador
 * Photon, igual que el buscador de la app bar, pero con su propio estado
 * para no interferir con GeolocationsService.places), combustible, desvío
 * máximo y capacidad de depósito opcional. Al calcular, reutiliza
 * MapService.planRoute() (OSRM + búsqueda de la más barata cerca de la
 * ruta), que además dibuja la ruta en el mapa.
 */
@Component({
  selector: 'app-route-planner',
  templateUrl: './route-planner.component.html',
  styleUrls: ['./route-planner.component.css'],
  standalone: false
})
export class RoutePlannerComponent implements OnInit, OnDestroy {

  readonly fuelOptions = FUEL_OPTIONS;
  readonly assumedConsumption = ASSUMED_CONSUMPTION_L_PER_100KM;

  originQuery = '';
  originCoords?: [number, number];
  originResults: Feature[] = [];
  isSearchingOrigin = false;

  destinationQuery = '';
  destinationCoords?: [number, number];
  destinationResults: Feature[] = [];
  isSearchingDestination = false;

  selectedFuel: FuelKey = 'gasoleo_a';
  maxDetourKm = ROUTE_BUFFER_KM;
  tankCapacityLiters?: number;

  isCalculating = false;
  errorMessage?: string;
  result?: PlannerResult;

  private originDebounce?: ReturnType<typeof setTimeout>;
  private destinationDebounce?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly placesApi: PlacesApiClient,
    private readonly mapService: MapService,
    private readonly geolocationsService: GeolocationsService
  ) { }

  ngOnInit(): void {
    this.selectedFuel = this.mapService.selectedFuelKey;

    if(this.geolocationsService.userLocation){
      this.originCoords = this.geolocationsService.userLocation;
      this.originQuery = this.geolocationsService.usingDefaultLocation
        ? 'Madrid (ubicación por defecto)'
        : 'Mi ubicación actual';
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.originDebounce);
    clearTimeout(this.destinationDebounce);
  }

  onOriginQueryChanged(query: string){
    this.originCoords = undefined;
    this.result = undefined;
    clearTimeout(this.originDebounce);

    if(query.trim().length === 0){
      this.originResults = [];
      return;
    }

    this.originDebounce = setTimeout(() => this.searchOrigin(query), 350);
  }

  onDestinationQueryChanged(query: string){
    this.destinationCoords = undefined;
    this.result = undefined;
    clearTimeout(this.destinationDebounce);

    if(query.trim().length === 0){
      this.destinationResults = [];
      return;
    }

    this.destinationDebounce = setTimeout(() => this.searchDestination(query), 350);
  }

  private searchOrigin(query: string){
    this.isSearchingOrigin = true;
    this.placesApi.search(query, this.geolocationsService.userLocation).subscribe({
      next: resp => {
        this.isSearchingOrigin = false;
        this.originResults = resp.features;
      },
      error: () => {
        this.isSearchingOrigin = false;
        this.originResults = [];
      }
    });
  }

  private searchDestination(query: string){
    this.isSearchingDestination = true;
    this.placesApi.search(query, this.geolocationsService.userLocation).subscribe({
      next: resp => {
        this.isSearchingDestination = false;
        this.destinationResults = resp.features;
      },
      error: () => {
        this.isSearchingDestination = false;
        this.destinationResults = [];
      }
    });
  }

  selectOrigin(place: Feature){
    this.originCoords = place.center as [number, number];
    this.originQuery = place.text;
    this.originResults = [];
  }

  selectDestination(place: Feature){
    this.destinationCoords = place.center as [number, number];
    this.destinationQuery = place.text;
    this.destinationResults = [];
  }

  get canCalculate(): boolean {
    return !!this.originCoords && !!this.destinationCoords && !this.isCalculating;
  }

  calculate(){
    this.errorMessage = undefined;
    this.result = undefined;

    if(!this.originCoords || !this.destinationCoords){
      this.errorMessage = 'Indica origen y destino para calcular la ruta.';
      return;
    }

    this.isCalculating = true;

    this.mapService.planRoute(this.originCoords, this.destinationCoords, this.selectedFuel, this.maxDetourKm)
      .subscribe({
        next: ({ cheapest }) => {
          this.isCalculating = false;

          if(!cheapest){
            this.errorMessage = `No se ha encontrado ninguna gasolinera con ese combustible a menos de ${ this.maxDetourKm } km de la ruta.`;
            return;
          }

          this.result = this.buildResult(cheapest);
        },
        error: () => {
          this.isCalculating = false;
          this.errorMessage = 'No se ha podido calcular la ruta. Inténtalo de nuevo.';
        }
      });
  }

  private buildResult(cheapest: CheapestOnRouteResult): PlannerResult {
    const fuelLabel = FUEL_OPTIONS.find(option => option.key === this.selectedFuel)?.label ?? '';

    return {
      stationName: cheapest.feature.properties.Estacion ?? 'Gasolinera',
      address: cheapest.feature.properties.Direccion,
      price: cheapest.price,
      fuelLabel,
      detourKm: cheapest.detourKm,
      savingsEstimate: this.estimateSavings(cheapest)
    };
  }

  /**
   * Ahorro estimado = (precio medio de referencia - precio en la estación
   * encontrada) × litros del depósito, menos el coste del combustible extra
   * consumido en el desvío (ida y vuelta). El "precio de referencia" es el
   * precio medio del combustible seleccionado entre las gasolineras
   * actualmente visibles en el mapa: no hay una única "otra gasolinera" con
   * la que comparar, así que se usa esa media como aproximación razonable de
   * "lo que pagarías si no hicieras el desvío". undefined si no se informó
   * capacidad de depósito o no hay precio de referencia disponible.
   */
  private estimateSavings(cheapest: CheapestOnRouteResult): number | undefined {
    if(!this.tankCapacityLiters || this.tankCapacityLiters <= 0){
      return undefined;
    }

    const referencePrice = this.mapService.getAveragePrice(this.selectedFuel);
    if(referencePrice == null){
      return undefined;
    }

    const detourRoundTripKm = cheapest.detourKm * 2;
    const detourExtraLiters = (detourRoundTripKm / 100) * ASSUMED_CONSUMPTION_L_PER_100KM;
    const detourFuelCost = detourExtraLiters * cheapest.price;
    const fillUpSavings = (referencePrice - cheapest.price) * this.tankCapacityLiters;

    return fillUpSavings - detourFuelCost;
  }

}
