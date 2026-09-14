# ADR-2: Airflow (standalone) reemplaza a APScheduler

## Estado
Aceptada.

## Contexto
La orquestación actual (`backend/app/scheduler.py`) es un único job de
APScheduler ejecutándose dentro del propio proceso del backend: cron con solo
hora/minuto (no una expresión cron completa), `misfire_grace_time=3600`, sin
reintentos ni backoff, sin tareas independientes — todo ocurre dentro de una
función monolítica `run_ingestion()` con un único bloque try/except — y sin
historial de ejecuciones persistente (el estado vive en memoria, ver ADR-1).

Con la capa de datos Postgres + dbt ya disponible (ADR-1), existe la
oportunidad de descomponer la ingesta en tareas reales y orquestarlas con una
herramienta pensada para ello, en vez de seguir ampliando a mano las
capacidades de APScheduler.

### Opciones valoradas
- **Dagster / Prefect**: descartados — el objetivo explícito de esta decisión
  es dar señal de portfolio con Airflow específicamente, que es la
  herramienta solicitada.
- **Mantener APScheduler añadiendo reintentos a mano**: descartado — no da la
  señal de "orquestación real" buscada, y reimplementa a mano lo que Airflow
  ya resuelve (reintentos, backoff, historial, UI de observabilidad).
- **Airflow en modo producción de libro de texto** (Celery/Redis, triggerer y
  scheduler en contenedores separados): descartado por sobredimensionado para
  el volumen del proyecto (un DAG diario, ~11-12k filas).
- **Airflow standalone** (un único contenedor, `LocalExecutor`): elegido —
  variante ligera, suficiente para un DAG diario de este tamaño.

## Decisión
Se sustituye APScheduler por Airflow en modo **standalone**: un único
contenedor, `LocalExecutor`, sin Celery/Redis/triggerer separados.

El DAG `gasolineras_ingestion` (en `airflow/dags/`) descompone la ingesta en
tareas encadenadas:

1. `extract_raw` — baja el JSON crudo a Postgres (capa `raw`).
2. `dbt_run` — ejecuta los modelos `staging` y `marts`.
3. `dbt_test` — si falla, la cadena no continúa: los datos malos nunca llegan
   a Solr, algo que hoy no existe como salvaguarda.
4. `load_to_solr` — upsert del mart hacia Solr.
5. `prune_stale_in_solr` — mismo orden "upsert antes que borrar" que hoy, para
   no dejar el mapa vacío durante una ejecución.
6. `record_run_status` — se ejecuta siempre, incluso si alguna tarea anterior
   falla, y escribe en la tabla `gasolineras.ingestion_runs`.

Reintentos con backoff exponencial a nivel de DAG: 3 reintentos, 5 minutos de
espera inicial, hasta un máximo de 30 minutos.

El disparo manual (`POST /api/admin/reindex`) deja de llamar `run_ingestion()`
directamente y pasa a invocar la REST API de Airflow para lanzar el DAG,
manteniendo el mismo endpoint documentado, protegido por el mismo
`ADMIN_TOKEN`.

`GET /api/admin/status` deja de leer el dataclass en memoria y pasa a leer
`gasolineras.ingestion_runs` — el historial deja de perderse al reiniciar el
backend.

### Migración incremental
Para no romper nunca el flujo actual a mitad de camino, la migración se hace
en 5 pasos (repartidos entre EPIC-1 y EPIC-2, ver `docs/epics/`):

1. Postgres + proyecto dbt en paralelo, sin tocar la ingesta actual — Solr
   sigue funcionando exactamente igual vía APScheduler.
2. Descomponer `run_ingestion()` en funciones reutilizables (extract/load/
   prune) pero seguir llamándolas en el mismo orden desde APScheduler, sin
   cambiar todavía el disparador.
3. Levantar Airflow con el DAG en paralelo a APScheduler (pausado o en modo
   prueba), y comparar que produce el mismo resultado.
4. Cutover: apagar APScheduler, repuntar `/api/admin/reindex` y
   `/api/admin/status` hacia Airflow/Postgres.
5. Limpieza: borrar `scheduler.py` y la dependencia `apscheduler`.

## Consecuencias
- Se gana historial de ejecuciones persistente, reintentos con backoff, y una
  UI de observabilidad del pipeline (la de Airflow) que hoy no existe.
- Se introduce un servicio más en `docker-compose.yml` y una dependencia
  técnica nueva (Airflow) que hay que mantener actualizada.
- Airflow standalone es de un solo nodo: no hay alta disponibilidad ni
  escalado horizontal del executor. Se documenta explícitamente como
  aceptable para el volumen y la naturaleza de portfolio del proyecto; no es
  el despliegue recomendado para producción a mayor escala.
- El corte (paso 4) es el único punto de riesgo real de la migración: hasta
  ese momento, `/api/admin/reindex` y `/api/admin/status` siguen funcionando
  exactamente igual que hoy.
