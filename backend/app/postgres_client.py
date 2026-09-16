"""Cliente mínimo de Postgres para la landing table `gasolineras.raw_stations`
(ver EPIC-1, docs/epics/EPIC-1-capa-datos-postgres-dbt.md). Solo hace un
INSERT en bloque por ejecución de ingesta, así que no se justifica traer un
ORM/pool completo (SQLAlchemy) para esto: psycopg (async) es suficiente y
encaja con el resto del código async del proyecto (httpx.AsyncClient)."""

import logging
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

from .config import settings

logger = logging.getLogger("postgres_client")

# Nota de entorno: psycopg en modo async no soporta el ProactorEventLoop
# (policy por defecto de asyncio en Windows). El backend real (y el
# contenedor de Airflow que llama a esta función desde EPIC-2) corren
# siempre dentro de Docker (Linux, ver docker-compose.yml), donde esto no
# aplica. Si se ejecuta este módulo directamente en una máquina Windows
# fuera de Docker, hace falta forzar `asyncio.WindowsSelectorEventLoopPolicy()`
# antes de llamar a esta función.

# Tabla de aterrizaje (landing) de dbt: una fila por estación por ejecución
# de ingesta, con el payload crudo completo en una columna jsonb. dbt la
# consume como source (ver dbt/models/staging/_staging__sources.yml) pero no
# la gestiona (no es un modelo dbt) — la crea/mantiene este cliente porque es
# quien la escribe.
CREATE_RAW_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS gasolineras.raw_stations (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL,
    ideess TEXT,
    payload JSONB NOT NULL
);
"""

CREATE_RAW_TABLE_INDEXES_SQL = """
CREATE INDEX IF NOT EXISTS ix_raw_stations_run_id ON gasolineras.raw_stations (run_id);
CREATE INDEX IF NOT EXISTS ix_raw_stations_ideess ON gasolineras.raw_stations (ideess);
"""

INSERT_RAW_ROW_SQL = """
INSERT INTO gasolineras.raw_stations (run_id, ingested_at, ideess, payload)
VALUES (%s, %s, %s, %s)
"""

# Historial de ejecuciones del pipeline (EPIC-2, ver ADR-2): una fila por
# ejecución del DAG `gasolineras_ingestion`. La escribe/actualiza la tarea
# `record_run_status` del DAG (siempre, incluso si alguna tarea previa
# falló) y la lee `GET /api/admin/status`.
CREATE_INGESTION_RUNS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS gasolineras.ingestion_runs (
    run_id UUID PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    success BOOLEAN NOT NULL,
    source_total INTEGER,
    indexed INTEGER,
    pruned INTEGER,
    error TEXT
);
"""

UPSERT_INGESTION_RUN_SQL = """
INSERT INTO gasolineras.ingestion_runs
    (run_id, started_at, finished_at, success, source_total, indexed, pruned, error)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (run_id) DO UPDATE SET
    finished_at = EXCLUDED.finished_at,
    success = EXCLUDED.success,
    source_total = EXCLUDED.source_total,
    indexed = EXCLUDED.indexed,
    pruned = EXCLUDED.pruned,
    error = EXCLUDED.error
"""

SELECT_LATEST_INGESTION_RUN_SQL = """
SELECT run_id, started_at, finished_at, success, source_total, indexed, pruned, error
FROM gasolineras.ingestion_runs
ORDER BY started_at DESC
LIMIT 1
"""

SELECT_STATIONS_CURRENT_SQL = "SELECT * FROM gasolineras.stations_current"

# Histórico de precios (SCD-2) de una estación concreta, ver
# dbt/models/marts/fct_station_prices_history.sql (EPIC-6). Una fila por
# versión de precios, ordenadas por inicio de vigencia ascendente para que
# el router pueda devolverlas tal cual al frontend.
SELECT_PRICE_HISTORY_SQL = """
SELECT ideess, precio_gasoleo_a, precio_gasoleo_b, precio_gasoleo_premium,
       precio_gasolina_95_e5, precio_gasolina_98_e5, valid_from, valid_to, is_current
FROM gasolineras.fct_station_prices_history
WHERE ideess = %s
ORDER BY valid_from ASC
"""


def _conninfo() -> str:
    return (
        f"host={settings.postgres_host} port={settings.postgres_port} "
        f"dbname={settings.postgres_db} user={settings.postgres_user} "
        f"password={settings.postgres_password}"
    )


async def _execute(*statements: tuple) -> None:
    """Ejecuta una o más sentencias (SQL, params) en una única conexión y
    hace commit al final. Cada elemento es `(sql, params)`, o `(sql, params,
    "many")` para usar `executemany` (ver `extract_raw_to_postgres`). Reúne
    el patrón connect+cursor+commit que se repetía en cada función de
    escritura de este módulo."""

    async with await psycopg.AsyncConnection.connect(_conninfo()) as conn:
        async with conn.cursor() as cur:
            for statement in statements:
                sql, params, *mode = statement
                if mode == ["many"]:
                    await cur.executemany(sql, params)
                else:
                    await cur.execute(sql, params)
        await conn.commit()


async def _fetch_one(*setup_statements: tuple, query: tuple) -> tuple | None:
    """Ejecuta sentencias de preparación (p. ej. `CREATE TABLE IF NOT
    EXISTS`) y luego una consulta, devolviendo la primera fila o `None`."""

    async with await psycopg.AsyncConnection.connect(_conninfo()) as conn:
        async with conn.cursor() as cur:
            for sql, params in setup_statements:
                await cur.execute(sql, params)
            await cur.execute(*query)
            return await cur.fetchone()


async def _fetch_all_as_dicts(*setup_statements: tuple, query: tuple) -> list[dict]:
    """Igual que `_fetch_one`, pero devuelve todas las filas como `dict`
    (columna → valor), usando los nombres de columna reales de la consulta."""

    async with await psycopg.AsyncConnection.connect(_conninfo()) as conn:
        async with conn.cursor() as cur:
            for sql, params in setup_statements:
                await cur.execute(sql, params)
            await cur.execute(*query)
            columns = [desc.name for desc in cur.description]
            rows = await cur.fetchall()

    return [dict(zip(columns, row)) for row in rows]


async def extract_raw_to_postgres(raw_stations: list[dict], run_id: str | None = None) -> str:
    """Inserta el dump crudo de la API del Gobierno en `gasolineras.raw_stations`,
    una fila por estación, todas etiquetadas con el mismo `run_id` para que
    dbt pueda agrupar/comparar ejecuciones (histórico de precios SCD-2).

    Devuelve el `run_id` usado (generado si no se pasa uno)."""

    run_id = run_id or str(uuid4())
    ingested_at = datetime.now(timezone.utc)

    rows = [
        (run_id, ingested_at, raw.get("IDEESS"), Jsonb(raw))
        for raw in raw_stations
    ]
    await _execute(
        (CREATE_RAW_TABLE_SQL, None),
        (CREATE_RAW_TABLE_INDEXES_SQL, None),
        (INSERT_RAW_ROW_SQL, rows, "many"),
    )

    logger.info(
        "Insertadas %s filas crudas en gasolineras.raw_stations (run_id=%s).",
        len(raw_stations), run_id,
    )
    return run_id


async def record_ingestion_run(
    run_id: str,
    started_at: datetime,
    finished_at: datetime | None,
    success: bool,
    source_total: int | None = None,
    indexed: int | None = None,
    pruned: int | None = None,
    error: str | None = None,
) -> None:
    """Escribe (o actualiza, si ya existe el `run_id`) una fila en
    `gasolineras.ingestion_runs` con el resultado de una ejecución del DAG
    `gasolineras_ingestion` (EPIC-2). La llama la tarea `record_run_status`
    del DAG, siempre, incluso si alguna tarea previa falló."""

    await _execute(
        (CREATE_INGESTION_RUNS_TABLE_SQL, None),
        (UPSERT_INGESTION_RUN_SQL, (run_id, started_at, finished_at, success, source_total, indexed, pruned, error)),
    )

    logger.info(
        "Registrada ejecución de ingesta run_id=%s success=%s en gasolineras.ingestion_runs.",
        run_id, success,
    )


async def fetch_latest_ingestion_run() -> dict | None:
    """Devuelve la fila más reciente de `gasolineras.ingestion_runs`, o
    `None` si todavía no se ha ejecutado nunca el pipeline. La usa
    `GET /api/admin/status` (EPIC-2)."""

    columns = ["run_id", "started_at", "finished_at", "success", "source_total", "indexed", "pruned", "error"]
    row = await _fetch_one(
        (CREATE_INGESTION_RUNS_TABLE_SQL, None),
        query=(SELECT_LATEST_INGESTION_RUN_SQL, None),
    )
    return dict(zip(columns, row)) if row is not None else None


async def fetch_stations_current() -> list[dict]:
    """Lee el mart `gasolineras.stations_current` (columnas en snake_case,
    ver `dbt/models/marts/stations_current.sql`) para que la tarea
    `load_to_solr` del DAG pueda remapearlas al formato de Solr (EPIC-2)."""

    return await _fetch_all_as_dicts(query=(SELECT_STATIONS_CURRENT_SQL, None))


async def fetch_price_history(ideess: str) -> list[dict]:
    """Lee el histórico de versiones de precios (SCD-2) de una estación desde
    el mart `gasolineras.fct_station_prices_history` (ver EPIC-6). Devuelve
    lista vacía si la estación no tiene histórico todavía (alta reciente) —
    la comprobación de si la estación existe la hace el router contra Solr,
    no esta función."""

    return await _fetch_all_as_dicts(query=(SELECT_PRICE_HISTORY_SQL, (ideess,)))
