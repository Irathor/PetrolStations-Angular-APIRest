/**
 * Distancia entre dos puntos [lon, lat] en kilómetros (fórmula de Haversine).
 * Extraído de MapService para poder reutilizarlo también desde el panel de
 * favoritas y la card del popup de estación, sin duplicar la fórmula.
 */
export function haversineKm(a: number[], b: number[]): number {
    const toRad = (deg: number) => deg * Math.PI / 180;
    const [lon1, lat1] = a;
    const [lon2, lat2] = b;
    const R = 6371;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);
    const h = sinDLat * sinDLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinDLon * sinDLon;

    return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Orden por defecto de las listas de estaciones (favoritas, comparador): más
 * cercana primero, y a igual distancia (o sin distancia conocida, ambas
 * `undefined`), alfabético por nombre. Extraído porque `favorites-panel` y
 * `comparison-dialog` construían el mismo comparador por separado.
 */
export function sortByDistanceThenName<T extends { distanceKm?: number; name: string }>(a: T, b: T): number {
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name);
}
