# EPIC-6: Histórico de precios visible en la ficha de estación

## Historia de usuario
Como usuario, quiero ver cómo ha evolucionado el precio de una gasolinera en
los últimos días, para saber si el precio actual es una buena oportunidad o
no.

## Tipo
Normal

## Bloqueada por
EPIC-4 (nueva shell de navegación) — el gráfico se inserta en la card de
estación rediseñada en esa Epic.

## Criterios de aceptación
- [x] Nuevo endpoint `GET /api/oil-stations/{id}/price-history` que lee de
      `gasolineras.fct_station_prices_history` en Postgres y devuelve la
      serie temporal de precios por combustible para la estación indicada.
- [x] El endpoint responde 404 si el `id` de estación no existe.
- [x] La card de estación (rediseñada en EPIC-4) muestra un gráfico de
      evolución de precios por combustible usando `p-chart` (Chart.js
      integrado en PrimeNG, ya presente en el proyecto).
- [x] El gráfico distingue por combustible (el mismo seleccionado en la
      barra de la app, u otro si el usuario cambia la selección dentro de la
      card).
- [x] Si una estación no tiene histórico disponible (alta reciente), la card
      lo indica de forma clara en vez de mostrar un gráfico vacío o un error.

## Alcance
Backend (Tali): nuevo endpoint de solo lectura sobre el mart ya existente
`gasolineras.fct_station_prices_history` (sin migraciones nuevas, el mart ya
existe desde EPIC-1 y hoy no tiene consumidor).
Frontend (Miranda): integración del gráfico dentro de la card de estación de
EPIC-4, sin librerías nuevas.

## Fuera de alcance
- Analítica agregada por zona/provincia (posible fast-follow futuro, ver
  `docs/BACKLOG.md`).

## Estado
Completada.

Verificación de cierre (2026-09-15): stack completo (`postgres`+`solr`+
`airflow`+`backend`) levantado con `docker compose up -d --build`, DAG
disparado de verdad para poblar `fct_station_prices_history` con datos
reales (dos versiones de precio para varias estaciones, al haber corrido
la ingesta en dos días distintos). Endpoint probado directamente: 200 con
histórico real para una estación existente, 200 con `history: []` para el
caso sin datos, 404 para un id inexistente — los tres casos del contrato
verificados de verdad, no solo por tests mockeados.

`pytest` en `backend/`: 40/40 en verde. `ng build`/Jest (11/11) en verde.
`security-review` sobre el diff completo (EPIC-4 a EPIC-6): sin hallazgos
que bloqueen el cierre — se revisó explícitamente la interpolación sin
escapar en las queries de Solr que señaló Tali (patrón preexistente,
impacto real bajo hoy) y quedó anotada en `docs/BACKLOG.md` como fast-follow,
no como bloqueante.

Verificación visual real en navegador (Edge headless, con el backend real
sirviendo datos reales): botón "Ver evolución de precios" en el popup,
diálogo con gráfico de línea real (Chart.js vía `p-chart`), resumen
textual accesible (precio actual / hace N días / mínimo-máximo), y cambio
de combustible dentro del propio diálogo actualizando el gráfico
correctamente.

**Bug real encontrado y arreglado en esta verificación** (no de CSS esta
vez, sino de configuración): `proxy.conf.json` usaba `"/api/*"` como clave
de proxy — ese patrón de Angular solo hace match con un único segmento de
ruta tras `/api/`, así que `/api/oil-stations` y `/api/facets` (un
segmento) funcionaban, pero `/api/oil-stations/{id}/price-history` (dos
segmentos más) no: el dev-server devolvía el `index.html` de la SPA en vez
de proxyar al backend, con estado 200 (por eso no saltaba como error de
red obvio). Es un bug latente desde el origen del proyecto — nunca se
había ejercitado una ruta anidada así hasta esta Epic. Corregido cambiando
la clave a `"/api"` (prefijo, sin comodín), que sí hace match a cualquier
profundidad — es la forma recomendada en la documentación de Angular para
este caso. Verificado de nuevo tras el fix: la petición real devuelve JSON
correcto y el gráfico se pinta con datos reales.
