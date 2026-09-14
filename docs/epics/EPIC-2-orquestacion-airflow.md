# EPIC-2: Orquestación con Airflow

## Historia de usuario
Como responsable del proyecto, quiero que la ingesta diaria esté orquestada
por Airflow con reintentos, historial persistente y alertas de fallo, para
tener un pipeline de datos production-grade en vez de un cron en proceso sin
visibilidad.

## Tipo
Normal.

## Bloqueada por
EPIC-1 (Capa de datos Postgres + dbt) — necesita que existan los modelos dbt
y las funciones de ingesta ya descompuestas antes de poder orquestarlas.

## Criterios de aceptación
- [x] Nuevo servicio `airflow` en `docker-compose.yml` (modo standalone,
      `LocalExecutor`).
- [x] DAG `gasolineras_ingestion` con las tareas encadenadas descritas en
      ADR-2 (Airflow reemplaza a APScheduler), con reintentos y backoff
      exponencial (3 reintentos, 5 min inicial, hasta 30 min).
- [x] `POST /api/admin/reindex` dispara el DAG vía la REST API de Airflow en
      vez de llamar `run_ingestion()` en proceso.
- [x] `GET /api/admin/status` lee de `gasolineras.ingestion_runs` en vez del
      dataclass en memoria — el historial sobrevive a un reinicio del
      backend.
- [x] Alertas de fallo implementadas según ADR-3 (Alertas de fallo del
      pipeline de ingesta).
- [x] APScheduler desmontado por completo: `scheduler.py` borrado,
      dependencia `apscheduler` quitada de `requirements.txt`, sin código
      muerto residual.

## Alcance
Servicio Airflow, DAG `gasolineras_ingestion`, cambios en
`backend/app/routers/admin.py` y `backend/app/state.py`, cutover completo del
disparador, limpieza final de APScheduler.

## Fuera de alcance
Despliegue en la nube, alta disponibilidad de Airflow — se documenta
explícitamente en ADR-2 que el modo standalone es de un solo nodo y no está
pensado para eso.

## Estado
Completada.

Verificación de cierre (2026-09-14): stack completo (`postgres`+`solr`+`airflow`+
`backend`) levantado con `docker compose up -d --build`. DAG `gasolineras_ingestion`
parsea sin errores de importación (`airflow dags list-import-errors`), se disparó
una ejecución real vía `POST /api/admin/reindex` y las 6 tareas
(`extract_raw → dbt_run → dbt_test → load_to_solr → prune_stale_in_solr →
record_run_status`) terminaron en `success`, con 11.512 estaciones indexadas de
verdad en Solr. `GET /api/admin/status` confirmado leyendo desde
`gasolineras.ingestion_runs` (sobrevive a un reinicio del backend, ya no depende
de estado en memoria). `pytest` en `backend/`: 37/37 en verde. `security-review`
sobre el diff completo de la Epic: sin hallazgos.

Bugs encontrados y arreglados durante esta verificación (fixes acotados,
aplicados directamente sin relanzar a los agentes especializados):
1. `airflow standalone` genera su propia contraseña aleatoria para el usuario
   admin e ignora `_AIRFLOW_WWW_USER_USERNAME/PASSWORD`, rompiendo la
   autenticación básica que necesita el backend para llamar a la REST API con
   credenciales predecibles. Sustituido por un entrypoint propio
   (`airflow/entrypoint.sh`) que replica el resto del comportamiento de
   `standalone` (un único contenedor, `LocalExecutor`) pero fija el usuario
   admin explícitamente — hecho idempotente (borra y recrea el usuario) porque
   `airflow users create` no actualiza la contraseña de un usuario ya
   existente, algo que puede repetirse en cualquier reinicio con el volumen de
   Postgres persistente, no solo en la primera verificación.
2. dbt no podía escribir `logs/`/`target/` dentro de `/opt/dbt` (bind mount
   compartido con el repo, sin permisos de escritura para el usuario del
   contenedor de Airflow) — solucionado con `--log-path`/`--target-path`
   apuntando a `/tmp` dentro del contenedor, en las tareas `dbt_run`/`dbt_test`
   del DAG.
3. El remapeo mart→Solr (`mart_row_to_solr_doc`) no convertía a `float` los
   campos `BioEtanol`/`Ester_met_lico`, que psycopg devuelve como `Decimal`
   desde Postgres — no serializable a JSON al subir a Solr. Corregido igual
   que ya se hacía con los campos de precio.

Decisiones autónomas tomadas durante el desarrollo (documentadas aquí, no
ameritan ADR nuevo por ser detalle de implementación dentro del stack ya
decidido en ADR-2):
- `AIRFLOW__DATABASE__SQL_ALCHEMY_SCHEMA` no lo consume ningún código de
  Airflow 2.10.4 (verificado contra el código fuente); el aislamiento del
  esquema `airflow` se logra con `options=-csearch_path%3Dairflow` en la
  cadena de conexión SQLAlchemy.
- `AIRFLOW__API__AUTH_BACKENDS` se fija a `basic_auth` porque el backend de
  autenticación por defecto de la REST API de Airflow no acepta credenciales
  básicas.
- El servicio `airflow` monta `./backend:/opt/backend:ro` para reutilizar
  `app.ingestion`/`app.postgres_client` desde el DAG en vez de duplicar esa
  lógica; el Dockerfile de Airflow instala las mismas versiones de
  `httpx`/`pydantic-settings`/`psycopg` que `backend/requirements.txt`.
- `run_ingestion()` se eliminó por completo (no solo se dejó de invocar):
  mantenerla habría dejado un segundo camino de ingesta que salta los tests
  de dbt, justo lo que ADR-2 busca evitar.
- Gap descubierto y documentado (no resuelto en esta Epic, anotado en
  `docs/BACKLOG.md` y en "Limitaciones conocidas" del README): la caché de
  `GET /api/facets` ya no se invalida automáticamente al terminar la ingesta,
  porque ahora corre en el proceso de Airflow, no en el del backend — hoy solo
  se limpia al reiniciar el backend.
- Contrato de `POST /api/admin/reindex` cambiado de
  `{source_total, indexed, pruned}` a `{dag_run_id, status}`, porque la
  ejecución ahora es asíncrona en Airflow y no hay un resultado síncrono que
  devolver — documentado en `ReindexTriggerResponse`.
