from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import solr
from ..postgres_client import fetch_price_history

router = APIRouter(prefix="/api", tags=["oil-stations"])

# Precio de los combustibles sobre los que se puede filtrar/ordenar.
FUEL_FIELDS: dict[str, str] = {
    "gasoleo_a": "Precio_Gasoleo_A",
    "gasoleo_premium": "Precio_Gasoleo_Premium",
    "gasolina_95": "Precio_Gasolina_95_E5",
    "gasolina_98": "Precio_Gasolina_98_E5",
}
FuelKey = Literal["gasoleo_a", "gasoleo_premium", "gasolina_95", "gasolina_98"]

# Columnas del mart `fct_station_prices_history` (EPIC-6) -> FuelKey del
# frontend (src/app/mapbox/interfaces/fuel.ts). `precio_gasoleo_b` se deja
# fuera a propósito: no tiene FuelKey/selector correspondiente en la app,
# igual que ya pasa hoy en /api/oil-stations.
PRICE_HISTORY_FUEL_COLUMNS: dict[str, str] = {
    "precio_gasoleo_a": "gasoleo_a",
    "precio_gasoleo_premium": "gasoleo_premium",
    "precio_gasolina_95_e5": "gasolina_95",
    "precio_gasolina_98_e5": "gasolina_98",
}

FIELDS_TO_RETURN = "id,Estacion,Provincia,Direccion,Latitud,Longitud,Horario," + ",".join(FUEL_FIELDS.values())

# Nº de gasolineras cubre de sobra el volumen actual (~11-12k); si el
# dataset creciera mucho habría que paginar en condiciones.
MAX_ROWS = 20000


def _build_fq(
    provincias: list[str],
    estaciones: list[str],
    precio_min: float | None,
    precio_max: float | None,
    combustible: str,
    lat: float | None,
    lon: float | None,
    radius_km: float | None,
) -> str | None:
    clauses = []

    if provincias:
        clauses.append("(" + " OR ".join(f'Provincia:"{p}"' for p in provincias) + ")")

    if estaciones:
        clauses.append("(" + " OR ".join(f'Estacion:"{e}"' for e in estaciones) + ")")

    if precio_min is not None or precio_max is not None:
        lo = precio_min if precio_min is not None else "*"
        hi = precio_max if precio_max is not None else "*"
        field = FUEL_FIELDS[combustible]
        clauses.append(f"{field}:[{lo} TO {hi}]")

    if lat is not None and lon is not None and radius_km is not None:
        clauses.append(f"{{!geofilt sfield=location pt={lat},{lon} d={radius_km}}}")

    return " AND ".join(clauses) if clauses else None


@router.get("/oil-stations")
async def get_oil_stations(
    provincias: list[str] = Query(default=[]),
    estaciones: list[str] = Query(default=[]),
    precio_min: float | None = None,
    precio_max: float | None = None,
    combustible: FuelKey = Query(default="gasoleo_a", description="Combustible sobre el que aplica el filtro de precio"),
    lat: float | None = Query(default=None, description="Latitud del centro, junto con lon y radius_km para filtrar por radio"),
    lon: float | None = Query(default=None, description="Longitud del centro"),
    radius_km: float | None = Query(default=None, description="Radio de búsqueda en kilómetros"),
):
    """Devuelve las gasolineras que cumplen los filtros como GeoJSON,
    listo para usarse directamente como fuente de datos de Mapbox GL
    (incluido el clustering nativo)."""

    params = {
        "q": "*:*",
        "fl": FIELDS_TO_RETURN,
        "rows": MAX_ROWS,
        "wt": "json",
    }

    fq = _build_fq(provincias, estaciones, precio_min, precio_max, combustible, lat, lon, radius_km)
    if fq:
        params["fq"] = fq

    if lat is not None and lon is not None:
        # Las más cercanas primero cuando se busca por proximidad.
        params["sort"] = f"geodist(location,{lat},{lon}) asc"

    result = await solr.query(params)
    docs = result["response"]["docs"]

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [doc["Longitud"], doc["Latitud"]]},
            "properties": {k: v for k, v in doc.items() if k not in ("Latitud", "Longitud")},
        }
        for doc in docs
        if "Latitud" in doc and "Longitud" in doc
    ]

    return {"type": "FeatureCollection", "features": features}


async def _station_exists(station_id: str) -> bool:
    """Comprueba la existencia de la estación contra Solr (fuente de verdad
    ya usada por el resto de este router) en vez de contra Postgres: una
    estación que no existe en Solr no debería tener histórico consultable,
    y así evitamos una segunda fuente de verdad sobre qué estaciones son
    válidas."""

    result = await solr.query({"q": f'id:"{station_id}"', "rows": 1, "wt": "json"})
    return len(result["response"]["docs"]) > 0


@router.get("/oil-stations/{id}/price-history")
async def get_oil_station_price_history(id: str):
    """Serie temporal de precios por combustible de una estación (EPIC-6),
    leída del mart SCD-2 `gasolineras.fct_station_prices_history`. 404 si la
    estación no existe; 200 con `history: []` si existe pero no tiene
    histórico todavía (p. ej. alta reciente) — esa distinción la necesita el
    frontend para diferenciar "no encontrada" de "sin datos aún"."""

    if not await _station_exists(id):
        raise HTTPException(status_code=404, detail="Estación no encontrada")

    rows = await fetch_price_history(id)

    history = []
    for row in rows:
        precios = {
            fuel_key: row[column]
            for column, fuel_key in PRICE_HISTORY_FUEL_COLUMNS.items()
            if row[column] is not None
        }
        history.append(
            {
                "valid_from": row["valid_from"],
                "valid_to": row["valid_to"],
                "is_current": row["is_current"],
                "precios": precios,
            }
        )

    return {"id": id, "history": history}
