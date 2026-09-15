# EPIC-5: Planificador de ruta avanzado y Comparador de gasolineras

## Historia de usuario
Como usuario que va a repostar en un trayecto largo, quiero comparar varias
gasolineras a la vez y saber cuánto me ahorro de verdad (no solo el precio
por litro, sino contando el desvío), para elegir la opción que realmente me
cuesta menos.

## Tipo
Normal

## Bloqueada por
EPIC-4 (nueva shell de navegación) — necesita el menú
"Planificar ruta"/"Comparar" de la nueva shell para colgar esta
funcionalidad.

## Criterios de aceptación
- [x] El planificador de ruta permite introducir origen, destino y
      combustible, y ajustar el "desvío máximo" admitido (antes fijo a 2km),
      reutilizando la lógica de ruta + estación-más-barata ya existente
      (OSRM + cálculo de distancia a la ruta).
- [x] El resultado del planificador muestra la mejor opción con precio, km de
      desvío y ahorro estimado.
- [x] El usuario puede introducir la capacidad de su depósito, y el cálculo de
      ahorro pasa a considerar precio × litros más el coste estimado del
      combustible consumido en el desvío, no solo el precio por litro.
- [x] El comparador permite seleccionar entre 2 y 4 estaciones (desde el mapa
      o desde favoritas) y muestra una tabla comparativa con precio por
      combustible, distancia, estado abierta/cerrada y coste de viaje (cuando
      aplica), destacando visualmente la opción más barata.
- [x] No se introduce ningún endpoint backend nuevo: toda la lógica opera
      sobre los datos ya disponibles vía `/api/oil-stations` y el ruteo OSRM
      ya integrado.

## Alcance
Frontend Angular (Miranda) exclusivamente, sobre datos y servicios ya
existentes (`/api/oil-stations`, integración OSRM, favoritos). Se cuelga del
menú flotante introducido en EPIC-4.

## Fuera de alcance
- Guardar comparaciones o historial de rutas planificadas (posible
  fast-follow futuro, ver `docs/BACKLOG.md`).
- Cualquier endpoint backend nuevo.

## Estado
Completada.

Verificación de cierre (2026-09-15): `ng build` y `npm test` (Jest, 11/11)
en verde. Verificación visual real en navegador (Edge headless vía
puppeteer-core, backend/Solr reales corriendo), sin errores de consola:
- Planificador: origen (con ubicación por defecto editable), búsqueda de
  destino por Photon con sugerencias reales (Madrid → Barcelona), desvío
  máximo, capacidad de depósito, ruta dibujada en el mapa de verdad al
  enviar, resultado con estación (FAMILY ENERGY), precio, desvío (1.3 km) y
  ahorro estimado (€12.03) con el aviso de que el consumo es una estimación,
  no el real del vehículo.
- Comparador: botón "+ Comparar" en el popup de estación (con feedback
  "✓ Comparando"), tabla con dos estaciones reales (REPSOL vs. BLANCA),
  los 4 combustibles con "Sin dato" donde falta, distancia, estado
  abierta/cerrada, y "Más barata" resaltada correctamente sobre la de menor
  precio.
- Verificado también en viewport móvil (390px): el diálogo del planificador
  se adapta correctamente, sigue siendo usable.

Sin bugs de CSS esta vez (a diferencia de EPIC-4) — solo una comprobación de
interacción a tener en cuenta para quien siga trabajando en este componente:
tras seleccionar una sugerencia de destino, el campo de texto conserva el
texto tal como se escribió (p. ej. "Barcelona") en vez de mostrar la
sugerencia completa seleccionada ("Barcelona, Catalunya, España") — el
comportamiento funcional es correcto (las coordenadas sí quedan capturadas,
el botón de búsqueda se habilita y la ruta se calcula bien), es solo una
mejora de claridad visual pendiente, no un bug funcional. Anotado en
`docs/BACKLOG.md`.
