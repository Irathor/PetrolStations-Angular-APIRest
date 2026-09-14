from fastapi import APIRouter

from ..dependencies import solr
from ..schemas import FacetItem, FacetsResponse
from ..state import facets_cache

router = APIRouter(prefix="/api", tags=["facets"])


def _parse_facet_pairs(pairs: list) -> list[FacetItem]:
    # Solr devuelve los facets como una lista plana [nombre, count, nombre, count, ...]
    return [FacetItem(name=str(pairs[i]), count=pairs[i + 1]) for i in range(0, len(pairs), 2)]


@router.get("/facets", response_model=FacetsResponse)
async def get_facets():
    """Listas de provincias y estaciones disponibles, para poblar los filtros.
    Siempre sobre el dataset completo (no se filtran entre sí).

    El dataset solo cambia una vez al día (la ingesta orquestada por Airflow,
    ver EPIC-2), así que se cachea en memoria.

    NOTA (EPIC-2): antes de EPIC-2, `run_ingestion()` corría en este mismo
    proceso y podía invalidar esta caché directamente al terminar. Ahora la
    ingesta corre en el contenedor de Airflow, un proceso separado que no
    comparte memoria con el backend, así que esa invalidación automática ya
    no ocurre. De momento la caché solo se invalida al reiniciar el backend;
    queda anotado como fast-follow en docs/BACKLOG.md (p. ej. un TTL corto,
    o que el DAG llame a un endpoint interno de invalidación) en vez de
    resolverlo aquí sin que el usuario lo priorice."""

    if facets_cache.value is not None:
        return FacetsResponse(**facets_cache.value)

    params = {
        "q": "*:*",
        "rows": 0,
        "facet": "true",
        "facet.field": ["Estacion", "Provincia"],
        "facet.mincount": 1,
        "facet.sort": "count",
        "facet.limit": 500,
        # "Estacion" mezcla marcas reales (Repsol, Cepsa...) con identificadores
        # propios de gasolineras sin marca (p.ej. "Nº 10.935"), lo que deja miles
        # de valores que solo aparecen una vez. Un mincount más alto para este
        # campo concreto filtra ese ruido y deja solo cadenas con presencia real,
        # sin necesidad de tocar Provincia (que sí es un conjunto pequeño y cerrado).
        "f.Estacion.facet.mincount": 5,
        "wt": "json",
    }

    result = await solr.query(params)
    fields = result["facet_counts"]["facet_fields"]

    response = FacetsResponse(
        provincias=_parse_facet_pairs(fields.get("Provincia", [])),
        estaciones=_parse_facet_pairs(fields.get("Estacion", [])),
    )
    facets_cache.value = response.model_dump()
    return response
