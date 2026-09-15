import { Injectable } from '@angular/core';

import { Feature } from '../interfaces/places';
import { MapService } from './map.service';
import { PlacesApiClient } from '../api';
import { OilStationsService } from './oil-stations.service';
import { OilStationsCollection } from '../interfaces/oilstations';
import { OilStationsFilter } from '../interfaces/oilStationsFilter';
import { FacetsResponse } from '../interfaces/facets';
import { Observable, tap } from 'rxjs';

// Centro de Madrid: punto de partida razonable cuando no hay geolocalización
// real (permiso denegado, navegador sin soporte, error del sensor...). Antes
// la app se quedaba bloqueada en la pantalla de carga para siempre en ese caso.
const DEFAULT_LOCATION: [number, number] = [-3.7038, 40.4168];

@Injectable({
  providedIn: 'root'
})
export class GeolocationsService {

  userLocation?:[number,number];

  /** true si `userLocation` es el centro de Madrid por defecto, no la posición real del usuario. */
  public usingDefaultLocation: boolean = false;

  public isLoadingPlaces: boolean = false;
  public places: Feature[] = [];


  get locationReady(): boolean {
    return !!this.userLocation; //Si hay valor devuelvo un true (De ahí la doble negación)
  }

  constructor(
    private readonly placesApi: PlacesApiClient,
    private readonly mapService: MapService,
    private readonly oilStations: OilStationsService
    ) {
    this.getUserLocation(); //Llamamos la función para obtener la geolocalización del usuario una vez nada más se haga uso de este servicio

    // El botón "Cómo llegar" del popup de una gasolinera vive en MapService,
    // pero necesita la posición del usuario, que solo conoce este servicio.
    // Con este hook evitamos que MapService tenga que inyectar de vuelta a
    // GeolocationsService (dependencia circular entre ambos).
    this.mapService.setDirectionsHandler(destination => {
      if(this.userLocation){
        this.mapService.getRoutBetweenPoints(this.userLocation, destination);
      }
    });

    // Mismo motivo que el hook anterior: el popup y el panel de favoritas
    // necesitan la posición del usuario para calcular distancias, sin que
    // MapService dependa de este servicio.
    this.mapService.setUserLocationProvider(() => this.userLocation);
   }

  public async getUserLocation(): Promise<[number,number]> {
    return new Promise((resolve) => {
      if(!navigator.geolocation){
        resolve(this.useDefaultLocation());
        return;
      }

      navigator.geolocation.getCurrentPosition(
        ({coords})=> { //Desestructuro los datos de entrada para tomar el que necesito, las coordenadas
          this.userLocation = [coords.longitude, coords.latitude];
          resolve(this.userLocation);
        },
        () => {
          // Sin permiso o sin datos de posición: no bloqueamos la app, usamos
          // un centro por defecto en vez de dejar la pantalla de carga infinita.
          resolve(this.useDefaultLocation());
        }
      );
    });
  }

  private useDefaultLocation(): [number, number] {
    this.userLocation = DEFAULT_LOCATION;
    this.usingDefaultLocation = true;
    return this.userLocation;
  }

  getPlacesByQuery(query:string = ''){

    if(!this.userLocation){
      throw Error('No se ha podido geolocalizar');
    }

    if(query.length === 0){
      this.isLoadingPlaces = false;
      this.hideMenuPlaces();
      return;
    }

    this.isLoadingPlaces = true;

    this.placesApi.search(query, this.userLocation).subscribe(resp => {
        this.isLoadingPlaces=false;
        this.places=resp.features;

        //Para crear un marcador de los lugares que encontremos en el momento de buscarlos
        this.mapService.createMarkersFromPlaces(this.places, this.userLocation!);
      });
  }

  getOilStations(filter: OilStationsFilter = {}): Observable<OilStationsCollection> {
    return this.oilStations.getOilStationsInfo(filter).pipe(
      tap(collection => this.mapService.setOilStations(collection))
    );
  }

  getFacets(): Observable<FacetsResponse> {
    return this.oilStations.getFacets();
  }

  hideMenuPlaces(){
    this.places = [];
  }

}
