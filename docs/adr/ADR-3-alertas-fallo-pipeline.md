# ADR-3: Alertas de fallo del pipeline de ingesta

## Estado
Aceptada.

## Contexto
El propio README del proyecto ya reconoce esta carencia: no hay alertas
activas si la ingesta diaria falla — solo queda constancia en los logs y en
`GET /api/admin/status`. Con dbt tests que ahora pueden bloquear el pipeline
(ver ADR-2, tarea `dbt_test`), esta carencia se vuelve más relevante: un
fallo silencioso de un test de calidad de datos es peor que un fallo
silencioso de la propia ingesta, porque puede pasar más tiempo sin que nadie
lo note.

### Opciones valoradas
- **Servicio de alerting de pago (PagerDuty, Opsgenie)**: descartado —
  sobredimensionado para un proyecto de portfolio sin guardias ni SLA reales.
- **Callback de Airflow + webhook gratuito opcional**: elegido — aprovecha
  mecanismos ya presentes en Airflow (`on_failure_callback`) y en el
  ecosistema (webhooks de Discord/Slack), sin contratar ningún servicio
  nuevo.

## Decisión
Se implementa un `on_failure_callback` a nivel del DAG `gasolineras_ingestion`
en Airflow que:

1. Deja siempre un log de nivel `ERROR` con un prefijo identificable,
   reutilizando la infraestructura de logging ya existente en el proyecto.
2. Opcionalmente notifica a un webhook entrante gratuito (Discord o Slack
   incoming webhook) si el usuario decide configurar uno mediante variable de
   entorno — sin webhook configurado, el callback se limita al log.

## Consecuencias
- El caso base (sin webhook configurado) no añade ninguna dependencia nueva:
  solo mejora el log de fallo respecto al try/except monolítico actual.
- El caso opcional (con webhook) requiere que el usuario gestione un secreto
  más (`IA_*`/`AIRFLOW_*` según corresponda, sin prefijo si es verdaderamente
  compartido — a decidir en la implementación) en el `.env`.
- No sustituye a los tests de Mordin ni al checkeo de `GET /api/admin/status`;
  es una capa adicional de visibilidad reactiva ante fallos.
- No se cubre observabilidad más allá de la alerta puntual (trazas, métricas
  agregadas) — ver `docs/BACKLOG.md`, sección "Fuera de alcance".
