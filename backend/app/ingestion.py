import json
import logging

import httpx

from .config import settings
from .dependencies import solr
from .postgres_client import extract_raw_to_postgres
from .state import facets_cache, ingestion_status

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


async def run_ingestion() -> dict:
    """Descarga el dump completo del Gobierno y actualiza Solr sin dejarlo
    nunca vacío: primero se indexan (upsert) los datos frescos y solo
    después se borran las estaciones que ya no aparecen en el Gobierno. Así,
    durante los segundos que dura la ingesta, en el peor caso se ve alguna
    estación obsoleta de más — nunca un mapa sin datos.

    Además (EPIC-1), aterriza el dump crudo en Postgres (`extract_raw_to_postgres`)
    para que dbt pueda transformarlo. Es aditivo: si Postgres no está
    disponible, se registra el error pero la ingesta a Solr continúa igual
    que antes de este cambio — Solr sigue siendo la única dependencia dura
    de esta función hasta el cutover de EPIC-2."""

    try:
        logger.info("Iniciando ingesta de gasolineras desde la API del Gobierno...")
        raw_stations = await fetch_gov_data()

        try:
            await extract_raw_to_postgres(raw_stations)
        except Exception:
            logger.exception(
                "No se pudo escribir el dump crudo en Postgres; la ingesta a Solr continúa."
            )

        docs = [d for raw in raw_stations if (d := transform_station(raw)) is not None]
        new_ids = {d["id"] for d in docs}

        await load_to_solr(docs)
        pruned = await prune_stale_in_solr(new_ids)

        facets_cache.clear()

        result = {"source_total": len(raw_stations), "indexed": len(docs), "pruned": pruned}
        ingestion_status.record_success(**result)
        logger.info(
            "Ingesta completada: %s de %s estaciones indexadas, %s obsoletas eliminadas.",
            result["indexed"], result["source_total"], result["pruned"],
        )
        return result
    except Exception as exc:
        ingestion_status.record_error(str(exc))
        logger.exception("La ingesta de gasolineras ha fallado.")
        raise
