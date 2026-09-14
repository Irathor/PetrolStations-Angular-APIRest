import json
import logging

import httpx

from .config import settings
from .dependencies import solr

logger = logging.getLogger("ingestion")

# La API del Gobierno usa nombres de campo en español, con tildes y espacios,
# y no declara el charset correctamente en la respuesta (obliga a forzar UTF-8
# a mano más abajo). Aquí los traducimos a los nombres ya usados en el schema
# de Solr (heredados del volcado original del proyecto).
FIELD_MAP = {
    "Rótulo": "Estacion",
    "Provincia": "Provincia",
    "Municipio": "Municipio",
    "Localidad": "Localidad",
    "Dirección": "Direccion",
    "Horario": "Horario",
    "Margen": "Margen",
    "Remisión": "Remision",
    "C.P.": "C.P.",
    "Tipo Venta": "Tipo_Venta",
}

PRICE_FIELDS = {
    "Precio Gasoleo A": "Precio_Gasoleo_A",
    "Precio Gasoleo B": "Precio_Gasoleo_B",
    "Precio Gasoleo Premium": "Precio_Gasoleo_Premium",
    "Precio Gasolina 95 E5": "Precio_Gasolina_95_E5",
    "Precio Gasolina 98 E5": "Precio_Gasolina_98_E5",
}

# Mapeo del mart de dbt `gasolineras.stations_current` (columnas snake_case,
# ver dbt/models/marts/stations_current.sql) a los nombres de campo que
# espera Solr. Es el inverso de FIELD_MAP/PRICE_FIELDS de arriba — EPIC-1 dejó
# este remapeo pendiente explícitamente para el loader de EPIC-2 (ver cierre
# de EPIC-1 en docs/epics/).
MART_FIELD_MAP = {
    "estacion": "Estacion",
    "provincia": "Provincia",
    "municipio": "Municipio",
    "localidad": "Localidad",
    "direccion": "Direccion",
    "horario": "Horario",
    "margen": "Margen",
    "remision": "Remision",
    "cp": "C.P.",
    "tipo_venta": "Tipo_Venta",
}

MART_PRICE_FIELDS = {
    "precio_gasoleo_a": "Precio_Gasoleo_A",
    "precio_gasoleo_b": "Precio_Gasoleo_B",
    "precio_gasoleo_premium": "Precio_Gasoleo_Premium",
    "precio_gasolina_95_e5": "Precio_Gasolina_95_E5",
    "precio_gasolina_98_e5": "Precio_Gasolina_98_E5",
}


def _to_float(value: str | None) -> float | None:
    """La API devuelve decimales con coma ('1,749'); Solr necesita '.' y tipo numérico."""
    if not value:
        return None
    value = value.strip().replace(",", ".")
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _to_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def transform_station(raw: dict) -> dict | None:
    """Convierte un registro crudo de la API del Gobierno en un documento de Solr."""

    ideess = _to_int(raw.get("IDEESS"))
    lat = _to_float(raw.get("Latitud"))
    lon = _to_float(raw.get("Longitud (WGS84)"))

    if ideess is None or lat is None or lon is None:
        # Sin id de estación o sin coordenadas no hay forma útil de mostrarla en el mapa.
        return None

    doc: dict = {
        "id": str(ideess),
        "IDEESS": ideess,
        "IDMunicipio": _to_int(raw.get("IDMunicipio")),
        "IDProvincia": _to_int(raw.get("IDProvincia")),
        "IDCCAA": _to_int(raw.get("IDCCAA")),
        "Latitud": lat,
        "Longitud": lon,
        # Campo geoespacial combinado (Solr LatLonPointSpatialField), para
        # poder filtrar por radio con {!geofilt} sin reinventar geometría esférica.
        "location": f"{lat},{lon}",
        "BioEtanol": _to_float(raw.get("% BioEtanol")),
        "Ester_met_lico": _to_float(raw.get("% Éster metílico")),
    }

    for raw_key, solr_key in FIELD_MAP.items():
        value = raw.get(raw_key)
        if value:
            doc[solr_key] = value

    for raw_key, solr_key in PRICE_FIELDS.items():
        price = _to_float(raw.get(raw_key))
        if price is not None:
            doc[solr_key] = price

    return doc


def mart_row_to_solr_doc(row: dict) -> dict | None:
    """Convierte una fila del mart `gasolineras.stations_current` (columnas
    snake_case) en un documento de Solr, usando MART_FIELD_MAP/MART_PRICE_FIELDS.
    Análogo a `transform_station`, pero partiendo de Postgres en vez del dump
    crudo del Gobierno (EPIC-2, tarea `load_to_solr` del DAG)."""

    ideess = row.get("ideess")
    lat = row.get("latitud")
    lon = row.get("longitud")

    if ideess is None or lat is None or lon is None:
        return None

    lat = float(lat)
    lon = float(lon)

    doc: dict = {
        "id": str(ideess),
        "IDEESS": int(ideess),
        "IDMunicipio": row.get("id_municipio"),
        "IDProvincia": row.get("id_provincia"),
        "IDCCAA": row.get("id_ccaa"),
        "Latitud": lat,
        "Longitud": lon,
        "location": f"{lat},{lon}",
        "BioEtanol": float(v) if (v := row.get("bioetanol")) is not None else None,
        "Ester_met_lico": float(v) if (v := row.get("ester_metilico")) is not None else None,
    }

    for mart_col, solr_key in MART_FIELD_MAP.items():
        value = row.get(mart_col)
        if value:
            doc[solr_key] = value

    for mart_col, solr_key in MART_PRICE_FIELDS.items():
        value = row.get(mart_col)
        if value is not None:
            doc[solr_key] = float(value)

    return {k: v for k, v in doc.items() if v is not None}


def mart_rows_to_solr_docs(rows: list[dict]) -> list[dict]:
    """Aplica `mart_row_to_solr_doc` a todas las filas del mart, descartando
    las que no tengan id/coordenadas válidas (mismo criterio que `transform_station`)."""
    return [d for row in rows if (d := mart_row_to_solr_doc(row)) is not None]


async def fetch_gov_data() -> list[dict]:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(settings.gov_api_url)
        resp.raise_for_status()
        # El servidor no declara bien su charset; forzamos UTF-8 en vez de
        # confiar en la autodetección de encoding de httpx/requests.
        payload = json.loads(resp.content.decode("utf-8"))
        return payload["ListaEESSPrecio"]


async def load_to_solr(docs: list[dict]) -> None:
    """Sube (upsert) los documentos frescos a Solr."""
    await solr.add_documents(docs)


async def prune_stale_in_solr(new_ids: set[str]) -> int:
    """Borra de Solr las estaciones que ya no aparecen en el dump del
    Gobierno. Devuelve cuántas se han eliminado."""
    existing_ids = await solr.get_all_ids()
    stale_ids = existing_ids - new_ids
    await solr.delete_by_ids(list(stale_ids))
    return len(stale_ids)


# Nota (EPIC-2): la antigua `run_ingestion()` (fetch -> transform_station ->
# load_to_solr -> prune, con Postgres como escritura aditiva/best-effort) se
# retira aquí. La orquesta ahora el DAG `gasolineras_ingestion`
# (airflow/dags/gasolineras_ingestion.py), que encadena extract_raw -> dbt_run
# -> dbt_test -> load_to_solr (desde el mart, vía mart_rows_to_solr_docs) ->
# prune_stale_in_solr -> record_run_status. Mantener ambas rutas vivas a la
# vez habría dejado un segundo camino de ingesta que salta los tests de dbt
# — justo lo que ADR-2 (Airflow reemplaza a APScheduler) busca evitar.
# `transform_station`/`FIELD_MAP`/`PRICE_FIELDS` se conservan (con sus tests)
# porque documentan el mapeo original campo-a-campo desde el dump del
# Gobierno; no se invocan desde ningún camino de producción tras este cutover.
