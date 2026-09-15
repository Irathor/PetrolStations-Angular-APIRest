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
  dbt. Estado: Completada.
- `docs/epics/EPIC-2-orquestacion-airflow.md` — Orquestación con Airflow.
  Estado: Completada.
- `docs/epics/EPIC-3-escaneo-dependencias-ci.md` — Escaneo de dependencias en
  CI. Estado: Completada.
- `docs/epics/EPIC-4-nueva-shell-navegacion.md` — Nueva shell de navegación
  (app bar + menú flotante + drawer de filtros). Estado: Completada.
- `docs/epics/EPIC-5-planificador-comparador.md` — Planificador de ruta
  avanzado y comparador de gasolineras. Estado: Completada.
- `docs/epics/EPIC-6-historico-precios-estacion.md` — Histórico de precios
  visible en la ficha de estación. Estado: Propuesta.
- `docs/epics/EPIC-7-frontend-docker-nginx.md` — Frontend en Docker (nginx)
  para producción. Estado: Propuesta.

## Niebla

- **Invalidación de la caché de `/api/facets` tras la ingesta** — desde
  EPIC-2, la ingesta corre en el proceso de Airflow (contenedor separado del
  backend), así que la invalidación automática que antes ocurría al terminar
  `run_ingestion()` en el mismo proceso ya no dispara: hoy la caché de
  facetas solo se limpia al reiniciar el backend. La dirección es clara (algo
  tiene que invalidarla desde fuera del proceso), pero la solución concreta
  no está afilada todavía — un TTL corto en la caché, o que el DAG llame a un
  endpoint interno de invalidación al terminar `load_to_solr`, son las dos
  opciones más obvias, sin decidir cuál encaja mejor. Descubierto y anotado
  durante el cierre de EPIC-2 (2026-09-14).
- **Sistema de cuentas/login de usuario** — el mockup original que inspiró
  el rediseño de frontend (EPIC-4 a EPIC-6) incluía notificaciones y avatar
  de usuario, pero se descartó explícitamente para esta ronda: los
  favoritos siguen siendo anónimos vía `localStorage`. Si en el futuro se
  quiere sincronizar favoritos entre dispositivos o personalizar alertas de
  precio, ahí es donde entraría cuentas — pero es un cambio de arquitectura
  real (auth, sesiones, backend de usuarios), no un detalle de UI, así que
  necesitaría su propio ADR y confirmación explícita del usuario cuando se
  plantee en firme. Anotado en la ronda de decisión del rediseño de
  frontend (2026-09-14).
- **Confirmación visual de destino en el planificador de ruta** — al
  seleccionar una sugerencia del buscador de destino (EPIC-5), el campo
  conserva el texto escrito en vez de mostrar la sugerencia completa
  seleccionada ("Barcelona" en vez de "Barcelona, Catalunya, España").
  Funcionalmente correcto (las coordenadas sí se capturan bien, la ruta se
  calcula bien), es solo una mejora de claridad visual pendiente de afinar.
  Descubierto en la verificación de cierre de EPIC-5 (2026-09-15).

## Vigilancia (sin acción posible por ahora)

- **`uuid` &lt;11.1.1 (moderate, sin fix disponible)** — arrastrado por
  `webpack-dev-server` (vía `sockjs`), a su vez dependencia de
  `@angular-devkit/build-angular`. Es tooling de build/desarrollo, no llega al
  bundle de producción. `npm audit fix` no puede resolverlo porque el
  mantenedor de `uuid` no ha publicado un fix todavía. Revisar cuando
  `pip-audit`/`npm audit` de EPIC-3 deje de reportarlo, o al actualizar
  `@angular-devkit/build-angular` a una versión mayor.

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
- **Capas de mapa de satélite/tráfico** — no existe alternativa gratuita sin
  token compatible con MapLibre+OpenFreeMap; Esri World Imagery sin key
  tiene términos de uso ambiguos para producción, se descarta por prudencia.
  Descartado en la ronda de decisión del rediseño de frontend (2026-09-14).
