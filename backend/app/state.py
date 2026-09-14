"""Estado compartido en memoria del proceso: caché de facets. Al ser un único
proceso (uvicorn sin workers múltiples) un simple objeto en memoria es
suficiente, sin necesidad de Redis ni similares.

(EPIC-2) El estado de la última ingesta (antes `IngestionStatus`, un
dataclass en memoria) se retira de aquí: ahora vive persistido en Postgres
(`gasolineras.ingestion_runs`, ver `backend/app/postgres_client.py`), porque
la ingesta la ejecuta el DAG de Airflow en un proceso/contenedor separado
que no comparte memoria con el backend."""

from dataclasses import dataclass
from typing import Any


@dataclass
class FacetsCache:
    value: dict[str, Any] | None = None

    def clear(self) -> None:
        self.value = None


facets_cache = FacetsCache()
