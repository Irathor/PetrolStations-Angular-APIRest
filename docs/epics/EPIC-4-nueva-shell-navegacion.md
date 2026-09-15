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
- [x] App bar superior implementada con `p-menubar`, con logo+marca a la
      izquierda, buscador de lugares (Photon) centrado, selector de
      combustible visible en la barra, toggle de estilo de mapa
      (oscuro/normal) y botón de menú — todos reubicando lógica ya existente,
      sin reimplementarla.
- [x] Menú principal flotante (se abre/cierra, no permanente) con accesos a
      Explorar, Cerca de mí, Favoritas y Filtros (este último abre el drawer).
- [x] "Cerca de mí" permite elegir radio entre 2/5/10/25/50 km (antes fijo a
      10km), usando el parámetro `radius_km` ya soportado por
      `/api/oil-stations`.
- [x] Panel de favoritas muestra, por cada estación guardada: nombre, precio
      del combustible seleccionado, distancia y si está abierta/cerrada; click
      u hover sobre un ítem centra el mapa en esa estación.
- [x] Filtros (provincia/marca/combustible/precio) se muestran en un
      `p-drawer` (derecha en desktop, abajo en móvil) con un badge indicando
      el número de filtros activos, sustituyendo la barra de filtros
      permanente actual. La persistencia en `localStorage` de los filtros se
      mantiene sin cambios de comportamiento.
- [x] La card de popup de estación se rediseña mostrando: nombre, dirección,
      precio destacado, badge de abierta/cerrada, distancia y botón "Cómo
      llegar" (reutilizando la lógica de ruteo ya existente).
- [x] En viewport móvil, se muestra una bottom navigation de 4 accesos
      (Explorar / Cerca de mí / Favoritas / Ruta) en vez de la barra de
      filtros apilada actual, y el drawer de filtros se abre desde abajo.
- [x] Ninguna funcionalidad existente (clustering, favoritos, cálculo de ruta
      más barata, horarios, selector de estilo de mapa) pierde comportamiento
      respecto al estado previo al rediseño.

## Alcance
Frontend Angular (Miranda), usando exclusivamente componentes PrimeNG ya
disponibles en el proyecto (`p-menubar`, `p-drawer`, componentes de menú
flotante) — no se añaden librerías de UI nuevas. Reutiliza los servicios
existentes (favoritos, MapService, filtros, ruteo OSRM).

Excepción mínima de alcance: `/api/oil-stations` no devolvía el campo
`Direccion` (aunque ya existía en Solr) y la card de estación rediseñada lo
necesita — se añadió esa única columna a `FIELDS_TO_RETURN` en
`backend/app/routers/oil_stations.py` (el orquestador lo hizo directamente,
verificado con pytest 37/37 en verde) para no bloquear a Miranda por un
campo de un solo carácter de diferencia en el backend.

## Fuera de alcance
- Capas de mapa de satélite/tráfico (no hay alternativa gratuita viable con
  MapLibre+OpenFreeMap).
- Cualquier sistema de cuentas/login/notificaciones (la campana y el avatar
  del mockup original quedan descartados explícitamente).
- El Comparador y el Planificador de ruta avanzado (ver EPIC-5).
- El histórico de precios en la ficha de estación (ver EPIC-6).

## Estado
Completada.

Verificación de cierre (2026-09-15): `ng build` y `npm test` (Jest, 6/6) en
verde. Verificación visual real en navegador (Edge headless vía
puppeteer-core, backend/Solr reales corriendo) en desktop (1400px) y móvil
(390px), sin errores de consola en ningún momento: app bar con las 4
acciones, menú flotante con las 4 entradas, selector de radio de "cerca de
mí" (2/5/10/25/50km) funcionando, drawer de filtros, popup de estación
rediseñado (nombre, horario, distancia, precio destacado, resto de precios,
botón "Cómo llegar"), panel de favoritas mostrando una estación marcada de
verdad (nombre/precio/distancia/abierta, badge de contador), bottom nav
móvil con los 4 accesos.

Dos bugs reales encontrados y arreglados durante esta verificación (fixes
de CSS acotados, aplicados directamente sin relanzar a Miranda):
1. El wrapper `.p-menubar-start` que genera PrimeNG internamente no se
   estiraba al ancho completo de la barra (pensado por defecto para un
   logo pequeño, no para una app bar completa) — el buscador quedaba
   descentrado y los controles de la derecha (combustible, centrar mapa,
   tema, menú) se apelotonaban en el centro en vez de ir al borde derecho.
   Corregido con `:host ::ng-deep .p-menubar-start { flex: 1 1 auto; width: 100% }`.
2. El aviso de "ubicación por defecto" y el de "cargando/sin resultados"
   (`top: 10px`, superpuestos con la app bar) se pintaban literalmente
   encima de los controles de la derecha, tapándolos por completo mientras
   el aviso estaba visible — confirmado con `elementFromPoint`, no era solo
   apariencia. Corregido bajándolos a `top: 88px`, debajo de la app bar.
