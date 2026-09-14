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
- [ ] Nuevo servicio `airflow` en `docker-compose.yml` (modo standalone,
      `LocalExecutor`).
- [ ] DAG `gasolineras_ingestion` con las tareas encadenadas descritas en
      ADR-2 (Airflow reemplaza a APScheduler), con reintentos y backoff
      exponencial (3 reintentos, 5 min inicial, hasta 30 min).
- [ ] `POST /api/admin/reindex` dispara el DAG vía la REST API de Airflow en
      vez de llamar `run_ingestion()` en proceso.
- [ ] `GET /api/admin/status` lee de `gasolineras.ingestion_runs` en vez del
      dataclass en memoria — el historial sobrevive a un reinicio del
      backend.
- [ ] Alertas de fallo implementadas según ADR-3 (Alertas de fallo del
      pipeline de ingesta).
- [ ] APScheduler desmontado por completo: `scheduler.py` borrado,
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
Propuesta.
