import { FuelKey } from './fuel';

export interface FacetItem {
    name: string;
    count: number;
}

export interface FacetsResponse {
    provincias: FacetItem[];
    estaciones: FacetItem[];
    preciosMaximos?: Partial<Record<FuelKey, number>>;
}
