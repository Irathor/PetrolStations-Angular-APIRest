"""DAG de orquestación de la ingesta diaria de gasolineras (EPIC-2, ver
docs/adr/ADR-2-airflow-reemplaza-apscheduler.md y ADR-3-alertas-fallo-pipeline.md).

Tareas encadenadas:
    extract_raw -> dbt_run -> dbt_test -> load_to_solr -> prune_stale_in_solr
        -> record_run_status (siempre, TriggerRule.ALL_DONE)

Reutiliza las funciones ya existentes en el backend (`app.ingestion`,
`app.postgres_client`) en vez de reimplementar la lógica de negocio aquí:
este DAG solo orquesta, no decide cómo se transforma un dato.

Importar el paquete `app` del backend requiere que sea visible en sys.path
dentro del contenedor de Airflow. La forma más simple (decisión de Tali,
ver resumen de cierre de EPIC-2) es montar `./backend` como volumen de solo
lectura en `/opt/backend` en el servicio `airflow` de docker-compose.yml
(Garrus) — aquí solo se añade esa ruta a sys.path como fallback si hiciera
falta ejecutar el DAG con otra disposición de volúmenes.
"""

import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx
from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.utils.state import State
from airflow.utils.trigger_rule import TriggerRule

_BACKEND_PATH = "/opt/backend"
if os.path.isdir(_BACKEND_PATH) and _BACKEND_PATH not in sys.path:
    sys.path.insert(0, _BACKEND_PATH)

logger = logging.getLogger("airflow.task")

DAG_ID = "gasolineras_ingestion"
ALERT_LOG_PREFIX = f"[{DAG_ID}]"

# Tareas cuyo estado determina si la ejecución global se considera exitosa
# en record_run_status (deliberadamente no incluye la propia record_run_status).
PIPELINE_TASK_IDS = ["extract_raw", "dbt_run", "dbt_test", "load_to_solr", "prune_stale_in_solr"]

DBT_PROJECT_DIR = "/opt/dbt"


def _run_async(coro):
    """Los operadores de Airflow ejecutan callables síncronos; el código de
    ingesta del backend es async (httpx.AsyncClient, psycopg async). Cada
    tarea corre su propio event loop aislado con asyncio.run()."""
    import asyncio

    return asyncio.run(coro)


def _extract_raw(**context):
    from app.ingestion import fetch_gov_data
    from app.postgres_client import extract_raw_to_postgres

    async def _inner():
        raw_stations = await fetch_gov_data()
        run_id = await extract_raw_to_postgres(raw_stations)
        return raw_stations, run_id

    raw_stations, run_id = _run_async(_inner())

    ti = context["ti"]
    ti.xcom_push(key="run_id", value=run_id)
    ti.xcom_push(key="source_total", value=len(raw_stations))
    logger.info("extract_raw: %s estaciones descargadas (run_id=%s).", len(raw_stations), run_id)


def _load_to_solr(**context):
    from app.ingestion import load_to_solr, mart_rows_to_solr_docs
    from app.postgres_client import fetch_stations_current

    async def _inner():
        rows = await fetch_stations_current()
        docs = mart_rows_to_solr_docs(rows)
        await load_to_solr(docs)
        return docs

    docs = _run_async(_inner())

    ti = context["ti"]
    ti.xcom_push(key="indexed", value=len(docs))
    ti.xcom_push(key="new_ids", value=[d["id"] for d in docs])
    logger.info("load_to_solr: %s documentos indexados en Solr.", len(docs))


def _prune_stale_in_solr(**context):
    from app.ingestion import prune_stale_in_solr

    ti = context["ti"]
    new_ids = set(ti.xcom_pull(task_ids="load_to_solr", key="new_ids") or [])
    pruned = _run_async(prune_stale_in_solr(new_ids))

    ti.xcom_push(key="pruned", value=pruned)
    logger.info("prune_stale_in_solr: %s estaciones obsoletas eliminadas.", pruned)


def _record_run_status(**context):
    from app.postgres_client import record_ingestion_run

    dag_run = context["dag_run"]
    ti = context["ti"]

    task_instances = {t.task_id: t.state for t in dag_run.get_task_instances()}
    failed_tasks = [
        task_id
        for task_id in PIPELINE_TASK_IDS
        if task_instances.get(task_id) not in (State.SUCCESS, State.SKIPPED)
    ]
    success = not failed_tasks

    run_id = ti.xcom_pull(task_ids="extract_raw", key="run_id") or str(uuid4())
    source_total = ti.xcom_pull(task_ids="extract_raw", key="source_total")
    indexed = ti.xcom_pull(task_ids="load_to_solr", key="indexed")
    pruned = ti.xcom_pull(task_ids="prune_stale_in_solr", key="pruned")

    started_at = dag_run.start_date or datetime.now(timezone.utc)
    finished_at = datetime.now(timezone.utc)
    error = None if success else f"Tareas fallidas o sin completar: {', '.join(failed_tasks)}"

    _run_async(
        record_ingestion_run(
            run_id=str(run_id),
            started_at=started_at,
            finished_at=finished_at,
            success=success,
            source_total=source_total,
            indexed=indexed,
            pruned=pruned,
            error=error,
        )
    )
    logger.info("record_run_status: run_id=%s success=%s", run_id, success)


def alert_on_failure(context):
    """on_failure_callback a nivel de DAG (ADR-3): siempre deja un log ERROR
    identificable, y opcionalmente notifica a un webhook entrante (Discord o
    Slack) si ALERT_WEBHOOK_URL está definida. Sin esa variable, se limita al
    log — no añade ninguna dependencia nueva en el caso base."""

    dag_id = context["dag"].dag_id
    task_id = context["task_instance"].task_id
    exception = context.get("exception")
    message = f"{ALERT_LOG_PREFIX} Fallo en la tarea '{task_id}' del DAG '{dag_id}': {exception}"
    logger.error(message)

    webhook_url = os.environ.get("ALERT_WEBHOOK_URL")
    if not webhook_url:
        return

    # Soporta tanto el formato de Discord ({"content": ...}) como el de Slack
    # ({"text": ...}) incoming webhook en el mismo POST, para no tener que
    # detectar el proveedor a partir de la URL.
    payload = {"content": message, "text": message}
    try:
        httpx.post(webhook_url, json=payload, timeout=10)
    except Exception:
        logger.exception(f"{ALERT_LOG_PREFIX} No se pudo notificar al webhook de alertas.")


default_args = {
    "owner": "gasolineras",
    "retries": 3,
    "retry_delay": timedelta(minutes=5),
    "retry_exponential_backoff": True,
    "max_retry_delay": timedelta(minutes=30),
}

with DAG(
    dag_id=DAG_ID,
    description="Ingesta diaria de gasolineras: raw -> dbt -> Solr (ver ADR-2/ADR-3).",
    default_args=default_args,
    schedule_interval="0 10 * * *",
    start_date=datetime(2026, 1, 1, tzinfo=timezone.utc),
    catchup=False,
    on_failure_callback=alert_on_failure,
    tags=["gasolineras", "ingestion"],
) as dag:

    extract_raw = PythonOperator(
        task_id="extract_raw",
        python_callable=_extract_raw,
    )

    # --log-path/--target-path fuera de /opt/dbt: ese directorio es un bind
    # mount de solo lectura efectiva para el usuario del contenedor (el
    # proyecto dbt vive en el repo, compartido con la verificación local de
    # EPIC-1), así que dbt no puede escribir ahí sus artefactos (logs/,
    # target/) en tiempo de ejecución del DAG — solo lee los modelos.
    DBT_LOG_PATH = "/tmp/dbt_logs"
    DBT_TARGET_PATH = "/tmp/dbt_target"

    dbt_run = BashOperator(
        task_id="dbt_run",
        bash_command=(
            f"dbt run --project-dir {DBT_PROJECT_DIR} --profiles-dir {DBT_PROJECT_DIR} "
            f"--log-path {DBT_LOG_PATH} --target-path {DBT_TARGET_PATH}"
        ),
    )

    dbt_test = BashOperator(
        task_id="dbt_test",
        bash_command=(
            f"dbt test --project-dir {DBT_PROJECT_DIR} --profiles-dir {DBT_PROJECT_DIR} "
            f"--log-path {DBT_LOG_PATH} --target-path {DBT_TARGET_PATH}"
        ),
    )

    load_to_solr_task = PythonOperator(
        task_id="load_to_solr",
        python_callable=_load_to_solr,
    )

    prune_stale_in_solr_task = PythonOperator(
        task_id="prune_stale_in_solr",
        python_callable=_prune_stale_in_solr,
    )

    record_run_status = PythonOperator(
        task_id="record_run_status",
        python_callable=_record_run_status,
        trigger_rule=TriggerRule.ALL_DONE,
    )

    extract_raw >> dbt_run >> dbt_test >> load_to_solr_task >> prune_stale_in_solr_task >> record_run_status
