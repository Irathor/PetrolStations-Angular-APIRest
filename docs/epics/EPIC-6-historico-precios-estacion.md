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
- [ ] Nuevo endpoint `GET /api/oil-stations/{id}/price-history` que lee de
      `gasolineras.fct_station_prices_history` en Postgres y devuelve la
      serie temporal de precios por combustible para la estación indicada.
- [ ] El endpoint responde 404 si el `id` de estación no existe.
- [ ] La card de estación (rediseñada en EPIC-4) muestra un gráfico de
      evolución de precios por combustible usando `p-chart` (Chart.js
      integrado en PrimeNG, ya presente en el proyecto).
- [ ] El gráfico distingue por combustible (el mismo seleccionado en la
      barra de la app, u otro si el usuario cambia la selección dentro de la
      card).
- [ ] Si una estación no tiene histórico disponible (alta reciente), la card
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
Propuesta
