# EPIC-1: Capa de datos Postgres + dbt

## Historia de usuario
Como responsable del proyecto, quiero una capa de datos relacional con
transformaciones y tests de calidad gestionados por dbt, para poder demostrar
prácticas reales de ingeniería de datos y tener una base sobre la que
construir orquestación real más adelante.

## Tipo
Normal (es infraestructura de datos con reglas deterministas de
transformación, no requiere IA/ML).

## Bloqueada por
Ninguna.

## Criterios de aceptación
- [x] Nuevo servicio `postgres` en `docker-compose.yml`, con esquema
      `gasolineras` para los datos de la aplicación.
- [x] Proyecto `dbt/` con modelos `staging.stg_stations` y, como mínimo,
      `marts.stations_current` (mismo shape plano que hoy consume Solr).
- [x] Tests dbt configurados:
  - `not_null` + `unique` en `IDEESS`.
  - `not_null` en `Latitud` y `Longitud`.
  - `accepted_range` en cada campo de precio.
  - Test de frescura sobre `raw.raw_stations`.
  - Test singular que verifica que la coma decimal española se parseó
    correctamente.
- [x] Modelo de histórico de precios `marts.fct_station_prices_history`, tipo
      SCD-2, que registra la evolución de precios por estación a lo largo del
      tiempo.
- [x] `run_ingestion()` (`backend/app/ingestion.py`) descompuesta en funciones
      reutilizables (extract/load/prune), sin cambiar todavía quién las
      invoca.
- [x] La ingesta actual (Solr vía APScheduler) sigue funcionando exactamente
      igual que antes de este Epic — es aditivo, no sustitutivo.

## Alcance
Nuevo servicio Postgres, proyecto dbt completo (raw/staging/marts + tests),
refactor interno de `ingestion.py` sin cambiar comportamiento observable.

## Fuera de alcance
Airflow, cutover del disparador de la ingesta, cambios en
`/api/admin/reindex` o `/api/admin/status` — eso corresponde a
EPIC-2 (orquestación con Airflow).

## Estado
Completada.

Verificación de cierre (2026-09-14): stack completo (`postgres`+`solr`+`backend`)
levantado con `docker compose up -d --build`, ingesta real disparada vía
`POST /api/admin/reindex` (11.510 estaciones, `gasolineras.raw_stations`
poblada correctamente), `dbt run`+`dbt test` ejecutados contra ese mismo
Postgres con datos reales: 3 modelos construidos, **30/30 tests en verde**.
`pytest` en `backend/`: 30/30 en verde. `security-review` ejecutado sobre el
diff completo: sin hallazgos (todo el SQL nuevo usa parámetros, sin
concatenación de valores no confiables).

Bug encontrado y arreglado durante esta verificación (no ameritaba relanzar
a Tali por ser un fix de una línea): la sintaxis `arguments:` anidada bajo
`dbt_utils.accepted_range` en `dbt/models/*/_*.yml` no es válida en
dbt-postgres 1.8 — los argumentos del test van directamente, sin esa clave
intermedia. Corregido en los 12 usos del test.

Decisiones autónomas tomadas durante el desarrollo (Tali, documentadas en su
resumen, sin ameritar ADR nuevo por ser detalle de implementación):
nombres de columna en los modelos dbt en `snake_case` minúsculas (Postgres
pliega a minúsculas los identificadores sin comillas, y los tests genéricos
de dbt generan SQL sin comillas) — el remapeo a los nombres exactos que
espera Solr (`IDEESS`, `Precio_Gasoleo_A`...) queda para el loader de
EPIC-2; fallo de escritura en Postgres no rompe la ingesta a Solr (try/except
alrededor de `extract_raw_to_postgres`, ver interpretación de "aditivo, no
sustitutivo").
