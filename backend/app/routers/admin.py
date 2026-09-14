import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..config import settings
from ..postgres_client import fetch_latest_ingestion_run
from ..schemas import IngestionStatusResponse, ReindexTriggerResponse
from ..security import require_admin_token

logger = logging.getLogger("admin")

router = APIRouter(prefix="/api", tags=["admin"])

AIRFLOW_DAG_ID = "gasolineras_ingestion"


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/admin/status", response_model=IngestionStatusResponse)
async def get_ingestion_status():
    """Para comprobar de un vistazo (o desde un monitor externo) que la
    ingesta diaria sigue funcionando: cuándo fue la última vez con éxito,
    cuántas gasolineras se cargaron, y el último error si lo hay.

    (EPIC-2) Lee la fila más reciente de `gasolineras.ingestion_runs`, que
    escribe la tarea `record_run_status` del DAG de Airflow, en vez del
    dataclass en memoria que se perdía al reiniciar el backend."""

    run = await fetch_latest_ingestion_run()
    if run is None:
        return IngestionStatusResponse(
            last_run_success=None,
            last_success_at=None,
            last_error_at=None,
            last_error=None,
            last_source_total=None,
            last_indexed=None,
            last_pruned=None,
        )

    finished_at = run["finished_at"]
    success = run["success"]
    return IngestionStatusResponse(
        last_run_success=success,
        last_success_at=finished_at if success else None,
        last_error_at=finished_at if not success else None,
        last_error=run["error"],
        last_source_total=run["source_total"],
        last_indexed=run["indexed"],
        last_pruned=run["pruned"],
    )


@router.post(
    "/admin/reindex",
    response_model=ReindexTriggerResponse,
    dependencies=[Depends(require_admin_token)],
)
async def trigger_reindex():
    """Dispara una ejecución manual del DAG `gasolineras_ingestion` en
    Airflow, sin esperar a la programación diaria. Útil en el primer
    arranque (Solr/Postgres vacíos) y para pruebas.

    (EPIC-2) Deja de llamar `run_ingestion()` en proceso: pasa a invocar la
    REST API de Airflow (ver ADR-2). La ejecución es asíncrona en Airflow —
    este endpoint solo confirma que se ha encolado, el resultado se consulta
    después con `GET /api/admin/status`."""

    url = f"{settings.airflow_base_url}/api/v1/dags/{AIRFLOW_DAG_ID}/dagRuns"
    auth = (settings.airflow_api_username, settings.airflow_api_password)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.post(url, json={}, auth=auth)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.exception("No se pudo lanzar el DAG '%s' en Airflow.", AIRFLOW_DAG_ID)
            raise HTTPException(
                status_code=502, detail="No se pudo lanzar la ingesta en Airflow"
            ) from exc

    payload = response.json()
    return ReindexTriggerResponse(
        dag_run_id=payload.get("dag_run_id", ""),
        status=payload.get("state", "queued"),
    )
