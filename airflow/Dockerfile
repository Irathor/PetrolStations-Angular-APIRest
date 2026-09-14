# Airflow standalone (ver ADR-2 en docs/adr/): un único contenedor,
# LocalExecutor, sin Celery/Redis/triggerer separados.
#
# Se parte de la imagen oficial de Airflow (ya trae Python 3.12 y todo lo
# necesario para el modo standalone) y solo se añade dbt, que el DAG
# gasolineras_ingestion invoca vía `dbt --project-dir /opt/dbt`.
#
# Versiones verificadas contra PyPI antes de fijarlas (ver
# ~/.claude/CLAUDE.md, "Dependencias nuevas"): dbt-core y dbt-postgres en
# 1.8.2, las mismas que usa el proyecto dbt de EPIC-1.
FROM apache/airflow:2.10.4-python3.12

USER airflow

# El DAG importa app.ingestion/app.postgres_client (montados como volumen
# de solo lectura desde ./backend, ver docker-compose.yml) para reutilizar
# la lógica de extracción/carga ya escrita en el backend. httpx/pydantic-
# settings/psycopg son las dependencias de ese camino de import concreto
# (no fastapi/uvicorn, que no se importan fuera de main.py) — versiones
# idénticas a backend/requirements.txt para evitar divergencias.
RUN pip install --no-cache-dir \
    dbt-core==1.8.2 \
    dbt-postgres==1.8.2 \
    httpx==0.27.2 \
    pydantic-settings==2.6.1 \
    "psycopg[binary]==3.3.5"

COPY --chown=airflow:0 entrypoint.sh /entrypoint.sh
USER root
RUN chmod +x /entrypoint.sh
USER airflow

# La imagen base fija su propio ENTRYPOINT (un script que reenvía "command:"
# como argumentos a `airflow ...`), así que un `command: /entrypoint.sh` en
# docker-compose.yml no lo ejecuta como script — hay que sustituir el
# ENTRYPOINT explícitamente.
ENTRYPOINT ["/entrypoint.sh"]
