# EPIC-8: Modo de selección en el mapa para el comparador

## Historia de usuario
Como usuario que quiere comparar varias gasolineras, quiero activar un modo
de selección en el mapa y añadir/quitar estaciones tocando directamente sus
marcadores, para no tener que abrir el popup de cada una y buscar el botón
"+ Comparar" dentro.

## Tipo
Normal

## Bloqueada por
Ninguna.

## Criterios de aceptación
- [x] Desde `app-main-menu` hay una opción "Comparar" que activa el modo de
      selección en el mapa (sustituye al punto de entrada anterior de abrir
      el popup y pulsar "+ Comparar" dentro; el popup dejará de mostrar ese
      botón).
- [x] Mientras el modo de selección está activo, un clic sobre el marcador
      de una estación la añade a la comparación si no estaba, o la quita si
      ya estaba (toggle), sin abrir su popup.
- [x] El marcador de cada estación seleccionada muestra un resaltado visual
      distintivo (estilo/color diferenciado) mientras dure la selección, y
      pierde ese resaltado al deseleccionarse.
- [x] Se mantiene el límite de 4 estaciones ya existente en
      `ComparisonService`: al intentar seleccionar una quinta estación con
      el modo activo, no se añade y se muestra el mismo aviso de límite que
      ya usa el flujo actual (o equivalente reutilizando el servicio), sin
      romper la selección ya hecha.
- [x] Hay un control visible y siempre accesible mientras el modo está
      activo para salir de él (el mapa vuelve a su comportamiento normal:
      clic en marcador abre popup) sin perder la selección ya hecha en
      `ComparisonService`.
- [x] Hay un control visible mientras el modo está activo (independiente
      del anterior) para abrir la tabla comparativa (`app-comparison-dialog`,
      sin cambios en ese componente), disponible en cuanto hay al menos 2
      estaciones seleccionadas, igual que en el flujo previo.
- [x] Al entrar en el modo de selección con estaciones ya elegidas
      previamente en `ComparisonService` (por ejemplo, sesión anterior en la
      misma pestaña), sus marcadores aparecen ya resaltados como
      seleccionados.
- [x] Cerrar `app-comparison-dialog` no desactiva el modo de selección: el
      usuario vuelve al mapa pudiendo seguir añadiendo o quitando estaciones
      hasta que use el control de salida explícito.

## Alcance
Frontend Angular (`src/app/mapbox/`): interacción de marcadores en el mapa,
`app-main-menu`, y el uso de `ComparisonService` (sin cambios en su lógica
de límite de 4, solo en cómo se invoca). No se toca `app-comparison-dialog`.

## Fuera de alcance
- Cualquier cambio en `ComparisonService` más allá de cómo se invoca desde
  el nuevo modo (el límite de 4 y la lógica de tabla comparativa no
  cambian).
- Guardar o recordar el modo de selección entre recargas de página.
- Cualquier endpoint backend nuevo.

## Estado
Completada.

Verificación real con navegador headless (Edge + Puppeteer) contra el stack
completo en Docker Compose:
- Activar "Comparar" desde el menú muestra la barra flotante con 0
  seleccionadas y sin abrir ningún popup.
- 4 clics en marcadores distintos seleccionan 4 estaciones (resaltadas con
  halo amarillo, capa `oil-stations-comparison-halo` separada de la capa de
  puntos, filtrada por id); un 5º clic no añade y muestra el aviso
  "Máximo 4 estaciones seleccionadas" en un popup transitorio.
- Clicar de nuevo una estación ya seleccionada la deselecciona (halo
  desaparece, contador baja a 3).
- "Ver comparativa" abre `app-comparison-dialog` con las estaciones
  seleccionadas; cerrar el diálogo (Escape) no desactiva el modo de
  selección (la barra sigue visible).
- "Salir" desactiva el modo; un clic posterior en un marcador vuelve a
  abrir su popup normal en vez de alternar la comparación.

Decisiones tomadas durante la implementación (no son decisiones grandes,
quedan documentadas aquí en vez de en un ADR):
- El resaltado de selección se implementa como una capa de círculos
  aparte (`oil-stations-comparison-halo`) filtrada por `id`, en vez de
  `feature-state` de MapLibre, porque las estaciones usan clustering y su
  identificador vive en `properties.id`, no como id de feature GeoJSON
  (usar `feature-state` habría requerido `promoteId` y complicaba la
  interacción con los clusters).
- El estado del modo de selección vive en `ComparisonService` (no en
  `MapService`), porque es estado de la feature "comparar", que ya vivía
  ahí; `MapService` solo lo lee.
- Se eliminó el botón "+ Comparar" del popup de estación y su CSS asociado
  (`.station-popup__compare-btn*`), al quedar duplicado con el nuevo modo.
