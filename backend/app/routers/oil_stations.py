from typing import Literal

from fastapi import APIRouter, Query

from ..dependencies import solr

router = APIRouter(prefix="/api", tags=["oil-stations"])

# Precio de los combustibles sobre los que se puede filtrar/ordenar.
FUEL_FIELDS: dict[str, str] = {
    "gasoleo_a": "Precio_Gasoleo_A",
    "gasoleo_premium": "Precio_Gasoleo_Premium",
    "gasolina_95": "Precio_Gasolina_95_E5",
    "gasolina_98": "Precio_Gasolina_98_E5",
}
FuelKey = Literal["gasoleo_a", "gasoleo_premium", "gasolina_95", "gasolina_98"]

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
