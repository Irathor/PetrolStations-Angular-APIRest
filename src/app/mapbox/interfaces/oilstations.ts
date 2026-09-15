// La API propia devuelve las gasolineras ya en formato GeoJSON, listo para
// usarse directamente como fuente de datos de Mapbox GL (incluido el
// clustering nativo, que exige justamente este formato).

export interface OilStationProperties {
    id: string;
    Estacion?: string;
    Provincia?: string;
    Direccion?: string;
    Horario?: string;
    Precio_Gasoleo_A?: number;
    Precio_Gasoleo_Premium?: number;
    Precio_Gasolina_95_E5?: number;
    Precio_Gasolina_98_E5?: number;
}

export type OilStationFeature = GeoJSON.Feature<GeoJSON.Point, OilStationProperties>;

export type OilStationsCollection = GeoJSON.FeatureCollection<GeoJSON.Point, OilStationProperties>;
