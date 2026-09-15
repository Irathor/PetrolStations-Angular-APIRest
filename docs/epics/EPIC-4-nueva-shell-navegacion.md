# EPIC-4: Nueva shell de navegación (app bar + menú flotante + drawer de filtros)

## Historia de usuario
Como usuario de la app, quiero una navegación más clara y moderna que deje
protagonismo al mapa, para encontrar rápido las acciones que ya existen
(filtros, favoritos, cerca de mí) sin que compitan visualmente con el mapa.

## Tipo
Normal

## Bloqueada por
Ninguna

## Criterios de aceptación
- [ ] App bar superior implementada con `p-menubar`, con logo+marca a la
      izquierda, buscador de lugares (Photon) centrado, selector de
      combustible visible en la barra, toggle de estilo de mapa
      (oscuro/normal) y botón de menú — todos reubicando lógica ya existente,
      sin reimplementarla.
- [ ] Menú principal flotante (se abre/cierra, no permanente) con accesos a
      Explorar, Cerca de mí, Favoritas y Filtros (este último abre el drawer).
- [ ] "Cerca de mí" permite elegir radio entre 2/5/10/25/50 km (antes fijo a
      10km), usando el parámetro `radius_km` ya soportado por
      `/api/oil-stations`.
- [ ] Panel de favoritas muestra, por cada estación guardada: nombre, precio
      del combustible seleccionado, distancia y si está abierta/cerrada; click
      u hover sobre un ítem centra el mapa en esa estación.
- [ ] Filtros (provincia/marca/combustible/precio) se muestran en un
      `p-drawer` (derecha en desktop, abajo en móvil) con un badge indicando
      el número de filtros activos, sustituyendo la barra de filtros
      permanente actual. La persistencia en `localStorage` de los filtros se
      mantiene sin cambios de comportamiento.
- [ ] La card de popup de estación se rediseña mostrando: nombre, dirección,
      precio destacado, badge de abierta/cerrada, distancia y botón "Cómo
      llegar" (reutilizando la lógica de ruteo ya existente).
- [ ] En viewport móvil, se muestra una bottom navigation de 4 accesos
      (Explorar / Cerca de mí / Favoritas / Ruta) en vez de la barra de
      filtros apilada actual, y el drawer de filtros se abre desde abajo.
- [ ] Ninguna funcionalidad existente (clustering, favoritos, cálculo de ruta
      más barata, horarios, selector de estilo de mapa) pierde comportamiento
      respecto al estado previo al rediseño.

## Alcance
Frontend Angular (Miranda), usando exclusivamente componentes PrimeNG ya
disponibles en el proyecto (`p-menubar`, `p-drawer`, componentes de menú
flotante) — no se añaden librerías de UI nuevas. Reutiliza los servicios
existentes (favoritos, MapService, filtros, ruteo OSRM) sin tocar el backend.

## Fuera de alcance
- Capas de mapa de satélite/tráfico (no hay alternativa gratuita viable con
  MapLibre+OpenFreeMap).
- Cualquier sistema de cuentas/login/notificaciones (la campana y el avatar
  del mockup original quedan descartados explícitamente).
- El Comparador y el Planificador de ruta avanzado (ver EPIC-5).
- El histórico de precios en la ficha de estación (ver EPIC-6).

## Estado
Propuesta
