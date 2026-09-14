# Backlog

Este archivo distingue tres cosas que no son lo mismo (ver
`~/.claude/CLAUDE.md`, sección "Backlog de fast-follows"): ítems ya listos
para convertirse en Epic, direcciones conocidas aún sin forma concreta, y
cosas descartadas deliberadamente.

## Fast-follows

Ya redactadas como Epics propiamente dichas — no se duplica su contenido
aquí, solo se referencian. Pendientes de que el usuario decida cuándo
implementarlas.

- `docs/epics/EPIC-1-capa-datos-postgres-dbt.md` — Capa de datos Postgres +
  dbt. Estado: Propuesta.
- `docs/epics/EPIC-2-orquestacion-airflow.md` — Orquestación con Airflow.
  Estado: Propuesta. Bloqueada por EPIC-1.
- `docs/epics/EPIC-3-escaneo-dependencias-ci.md` — Escaneo de dependencias en
  CI. Estado: Propuesta.

## Niebla

(Sin ítems por ahora.)

## Fuera de alcance

- **Publicación de imágenes Docker en CI (GHCR)** — no seleccionado por el
  usuario en la ronda de priorización del 2026-09-14.
- **Métricas/tracing (OpenTelemetry/Prometheus)** — evaluado y descartado por
  sobre-ingeniería para el volumen actual del proyecto (~11-12k filas/día, un
  proceso batch diario). La UI de Airflow (una vez implementado EPIC-2) ya
  cubre la necesidad real de "¿está sano mi pipeline?". Reconsiderar solo si
  el proyecto crece a un volumen/frecuencia que lo justifique.
- **Demo en vivo en la nube para este proyecto específico** — con
  Postgres + Airflow + Solr + backend, el stack resultante es más pesado que
  el de otros proyectos del portfolio del usuario. Se prioriza demo en vivo
  en los proyectos más ligeros primero; para este se considera más
  informativo un demo grabado (capturas/GIF de la UI de Airflow + del mapa)
  que uno en vivo.
