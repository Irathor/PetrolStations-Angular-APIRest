# ADR-1: Adopción de Postgres + dbt como capa de datos

## Estado
Aceptada.

## Contexto
Hoy Solr es la única persistencia de datos del proyecto. `backend/app/ingestion.py`
hace fetch → transform → upsert/prune directamente contra Solr, sin capa
relacional intermedia y sin historial de ejecuciones persistente — el estado
vive en un dataclass en memoria en `backend/app/state.py` que se pierde cada
vez que se reinicia el proceso del backend.

Se quiere añadir dbt al proyecto para demostrar transformaciones SQL versionadas
y tests de calidad de datos como parte del portfolio técnico, pero dbt necesita
un almacén SQL-consultable como destino, que hoy el proyecto no tiene.

Este es también el primer documento de `docs/` en este repositorio. No existía
convención previa de documentación de decisiones ni de Epics — a partir de este
ADR se adopta la convención del equipo (Epics en `docs/epics/`, ADRs en
`docs/adr/`, backlog en `docs/BACKLOG.md`, plantillas y numeración según
`~/.claude/CLAUDE.md`).

### Opciones valoradas
- **dbt directamente sobre Solr**: descartado — Solr no es SQL-consultable,
  dbt no lo soporta como destino.
- **Warehouse cloud (BigQuery, Snowflake)**: descartado — sobredimensionado y
  con coste recurrente para un proyecto de portfolio con ~11-12k filas/día de
  volumen.
- **Postgres + dbt**: elegido — SQL-consultable, gratuito, autoalojable en el
  mismo `docker-compose.yml`, y es el destino de referencia mejor soportado
  por dbt.

## Decisión
Se añade Postgres como nuevo servicio en `docker-compose.yml`, con tres capas
de datos gestionadas por dbt:

- **`raw`**: landing de la respuesta cruda de la API del Gobierno, una fila
  por estación por ejecución, almacenada en JSON.
- **`staging`**: casts y renombres que hoy hace `transform_station()` en
  Python, migrados a SQL. Mapeo de campos: `Rótulo` → `Estacion`,
  `Precio Gasoleo A` → `Precio_Gasoleo_A`, etc., incluyendo la normalización
  de coma decimal española a punto.
- **`marts`**: tabla final de estado actual (`stations_current`), con la
  misma forma plana que hoy consume Solr, más un modelo de histórico de
  precios tipo SCD-2 (`fct_station_prices_history`), aprovechando que ya se
  dispone de Postgres para justificar este tipo de modelo.

Solr pasa a ser exclusivamente el índice de lectura para el frontend,
alimentado desde el mart. El contrato con el frontend (`/api/oil-stations`,
GeoJSON) no cambia.

## Consecuencias
- La misma instancia de Postgres se comparte entre el esquema de metadatos de
  Airflow (`airflow`, ver ADR-2) y el esquema de datos de la aplicación
  (`gasolineras`) — aislados por esquema, no por contenedor separado. Es una
  decisión de escala de portfolio (un único desarrollador, hardware modesto);
  se documenta explícitamente que se dividiría en instancias separadas bajo
  requisitos reales de backup independiente o multi-tenencia.
- Aumenta la complejidad de `docker compose up` en local: un servicio más que
  levantar y mantener sano.
- Habilita la orquestación real descrita en ADR-2 (Airflow necesita un DAG con
  tareas independientes; hoy `run_ingestion()` es una función monolítica) y
  las alertas de fallo descritas en ADR-3.
- Introduce deuda de mantenimiento propia de dbt (modelos, tests, docs) que no
  existía antes.
