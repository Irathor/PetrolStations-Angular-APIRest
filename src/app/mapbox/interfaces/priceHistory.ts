import { FuelKey } from './fuel';

/**
 * Una versión del histórico de precios de una estación: el rango de validez
 * (`valid_to` es `null` en la versión vigente, `is_current: true`) y los
 * precios conocidos en ese rango. Un combustible sin dato en esa versión
 * simplemente no aparece como clave en `precios` (comprobar con `in` /
 * acceso opcional, nunca asumir `null`).
 */
export interface PriceHistoryEntry {
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  precios: Partial<Record<FuelKey, number>>;
}

/** Respuesta de GET /api/oil-stations/{id}/price-history. `history` viene ordenada por valid_from ascendente. */
export interface PriceHistoryResponse {
  id: string;
  history: PriceHistoryEntry[];
}
