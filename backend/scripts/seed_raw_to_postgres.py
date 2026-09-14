"""Script de seed único y desechable: pobla `gasolineras.raw_stations`
descargando el dump actual de la API del Gobierno.

TEMPORAL (EPIC-1): mientras no existe Airflow (EPIC-2), esta es la única
forma de tener datos en la landing table para poder ejecutar `dbt run`/
`dbt test` sin esperar al cron diario de `run_ingestion()`. Una vez EPIC-2
esté implementada, este script deja de hacer falta (Airflow dispara la
extracción) y se puede borrar.

Uso (desde `backend/`, con el venv activado y las variables POSTGRES_*
apuntando a la instancia correcta):

    python scripts/seed_raw_to_postgres.py
"""

import asyncio
import logging
import sys
from pathlib import Path

if sys.platform == "win32":
    # psycopg en modo async no soporta el ProactorEventLoop, que es la
    # policy por defecto de asyncio en Windows desde Python 3.8. El backend
    # real corre siempre dentro de Docker (Linux, ver docker-compose.yml),
    # donde no aplica — este ajuste solo hace falta para ejecutar este
    # script a mano en una máquina de desarrollo Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Permite ejecutar el script directamente (`python scripts/seed_raw_to_postgres.py`)
# sin tener que instalar el paquete `app` ni ajustar PYTHONPATH a mano.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ingestion import fetch_gov_data  # noqa: E402
from app.postgres_client import extract_raw_to_postgres  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed_raw_to_postgres")


async def main() -> None:
    logger.info("Descargando dump de la API del Gobierno...")
    raw_stations = await fetch_gov_data()
    logger.info("Descargadas %s estaciones. Insertando en Postgres...", len(raw_stations))

    run_id = await extract_raw_to_postgres(raw_stations)
    logger.info("Seed completado: run_id=%s, %s filas insertadas.", run_id, len(raw_stations))


if __name__ == "__main__":
    asyncio.run(main())
