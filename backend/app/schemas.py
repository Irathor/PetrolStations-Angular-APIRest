from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class FacetItem(BaseModel):
    name: str
    count: int


class FacetsResponse(BaseModel):
    # `populate_by_name=True` hace falta porque `routers/facets.py` construye
    # esta respuesta con el nombre de campo Python (`FacetsResponse(...,
    # precios_maximos=...)`) — sin él, Pydantic v2 solo aceptaría el alias
    # como kwarg de construcción. El alias camelCase (`preciosMaximos`) es lo
    # que expone el JSON (FastAPI serializa `response_model` con
    # `by_alias=True` por defecto) y también lo que usa la caché
    # (`facets_cache.value`, guardada y releída por alias con
    # `model_dump(by_alias=True)`/`model_validate(...)`).
    model_config = ConfigDict(populate_by_name=True)

    provincias: list[FacetItem]
    estaciones: list[FacetItem]
    precios_maximos: dict[str, float] = Field(default_factory=dict, alias="preciosMaximos")


class ReindexTriggerResponse(BaseModel):
    """(EPIC-2) Reemplaza a la antigua `ReindexResult`. Antes del cutover a
    Airflow, `POST /api/admin/reindex` ejecutaba la ingesta en proceso y
    devolvía el resultado (`source_total`/`indexed`/`pruned`) en la misma
    respuesta. Ahora solo encola una ejecución del DAG en Airflow —el
    resultado real llega más tarde, hay que consultarlo con
    `GET /api/admin/status`—, así que la respuesta cambia de shape para no
    fingir un resultado que todavía no existe. Cambio de contrato
    documentado aquí porque ADR-2 ya lo aprobó explícitamente."""

    dag_run_id: str
    status: str


class IngestionStatusResponse(BaseModel):
    """Shape mantenido lo más parecido posible al de antes de EPIC-2 (ver
    ADR-2) para no romper el contrato con quien ya consuma este endpoint,
    pero ahora reflejando una única fila (la más reciente) de
    `gasolineras.ingestion_runs` en vez del dataclass en memoria:
    - `last_success_at`/`last_error_at` ahora derivan de `finished_at` +
      `success` de esa fila (antes eran dos campos independientes que
      recordaban por separado el último éxito y el último error).
    - Se añade `last_run_success` explícito para no obligar al consumidor a
      inferir el resultado a partir de qué campo de fecha es `None`.
    """

    last_run_success: bool | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error: str | None
    last_source_total: int | None
    last_indexed: int | None
    last_pruned: int | None
