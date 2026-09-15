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
- [ ] El planificador de ruta permite introducir origen, destino y
      combustible, y ajustar el "desvío máximo" admitido (antes fijo a 2km),
      reutilizando la lógica de ruta + estación-más-barata ya existente
      (OSRM + cálculo de distancia a la ruta).
- [ ] El resultado del planificador muestra la mejor opción con precio, km de
      desvío y ahorro estimado.
- [ ] El usuario puede introducir la capacidad de su depósito, y el cálculo de
      ahorro pasa a considerar precio × litros más el coste estimado del
      combustible consumido en el desvío, no solo el precio por litro.
- [ ] El comparador permite seleccionar entre 2 y 4 estaciones (desde el mapa
      o desde favoritas) y muestra una tabla comparativa con precio por
      combustible, distancia, estado abierta/cerrada y coste de viaje (cuando
      aplica), destacando visualmente la opción más barata.
- [ ] No se introduce ningún endpoint backend nuevo: toda la lógica opera
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
Propuesta
