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
# (policy por defecto de asyncio en Windows). El backend real corre siempre
# dentro de Docker (Linux, ver docker-compose.yml), donde esto no aplica.
# Si se ejecuta este módulo directamente en una máquina Windows fuera de
# Docker (p. ej. desde scripts/seed_raw_to_postgres.py), hace falta forzar
# `asyncio.WindowsSelectorEventLoopPolicy()` antes de llamar a esta función.

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


def _conninfo() -> str:
    return (
        f"host={settings.postgres_host} port={settings.postgres_port} "
        f"dbname={settings.postgres_db} user={settings.postgres_user} "
        f"password={settings.postgres_password}"
    )


async def extract_raw_to_postgres(raw_stations: list[dict], run_id: str | None = None) -> str:
    """Inserta el dump crudo de la API del Gobierno en `gasolineras.raw_stations`,
    una fila por estación, todas etiquetadas con el mismo `run_id` para que
    dbt pueda agrupar/comparar ejecuciones (histórico de precios SCD-2).

    Devuelve el `run_id` usado (generado si no se pasa uno)."""

    run_id = run_id or str(uuid4())
    ingested_at = datetime.now(timezone.utc)

    async with await psycopg.AsyncConnection.connect(_conninfo()) as conn:
        async with conn.cursor() as cur:
            await cur.execute(CREATE_RAW_TABLE_SQL)
            await cur.execute(CREATE_RAW_TABLE_INDEXES_SQL)

            rows = [
                (run_id, ingested_at, raw.get("IDEESS"), Jsonb(raw))
                for raw in raw_stations
            ]
            await cur.executemany(INSERT_RAW_ROW_SQL, rows)
        await conn.commit()

    logger.info(
        "Insertadas %s filas crudas en gasolineras.raw_stations (run_id=%s).",
        len(raw_stations), run_id,
    )
    return run_id
