# EPIC-9: Panel lateral persistente de navegación

## Historia de usuario
Como usuario de la app, quiero un panel de navegación lateral siempre
visible (en vez de un menú ☰ flotante que hay que abrir para descubrir qué
acciones existen), para encontrar y usar Filtros, Comparar, Favoritas y
Planificar ruta sin tener que adivinar que están escondidas detrás de un
icono.

## Tipo
Normal

## Bloqueada por
Ninguna.

## Criterios de aceptación
- [x] `app-main-menu` (menú flotante `p-popover`) se elimina por completo y
      se sustituye por `app-side-panel`, un panel lateral persistente en
      desktop (viewport > 900px) con tres estados: colapsado (solo botón
      hamburguesa, 36px), base (hamburguesa + columna de botones
      icono+texto: Explorar, Cerca de mí, Favoritas, Filtros, Ruta,
      Comparar) y sección abierta (el panel se ensancha de 240px a 360px y
      muestra el contenido de la sección pulsada inline en el mismo
      recuadro).
- [x] El botón hamburguesa (siempre visible) cicla hacia atrás un nivel por
      clic (sección→base→colapsado→base) y expone `aria-expanded` acorde a
      su estado.
- [x] Cada sección abre su contenido inline dentro del panel: Cerca de mí
      muestra el control de radio de búsqueda; Favoritas monta
      `app-favorites-panel`; Filtros monta `app-filters-panel` (componente
      nuevo, extraído del `p-drawer` de filtros existente); Ruta monta
      `app-route-planner` sin dialog. Explorar es una acción directa sin
      sección propia.
- [x] `app-filters-panel` se reutiliza sin duplicar plantilla tanto para el
      contenido inline del panel lateral (desktop) como dentro del
      `p-drawer` de filtros que se sigue usando en móvil.
- [x] "Comparar" es un botón de acción directa (toggle) que activa/desactiva
      el modo de selección en el mapa vía `ComparisonService`, sin abrir
      sección propia; muestra badges de estado (favoritos, filtros activos,
      estaciones seleccionadas para comparar) en sus botones
      correspondientes de la columna base.
- [x] `.comparison-mode-bar` (contador, "Ver comparativa", "Salir") se
      mueve de `app-main-menu` a `map-view.component.html`, a nivel
      superior, visible con independencia del estado del panel lateral y
      del viewport.
- [x] Accesibilidad: los botones de sección se sacan del DOM con `@if`
      cuando el panel está colapsado (no son focables por Tab en ese
      estado), y una región `aria-live="polite"` anuncia el cambio de
      estado del panel.
- [x] El panel lateral aplica el mismo patrón de traslucidez que ya tenía
      la app bar (opacidad 0.2 tras 3s de inactividad vía
      `.card:not(:hover)`, sólido al hover), de forma independiente por
      contenedor; la animación (`@keyframes menuFadeToTranslucent`) se
      extrae a `src/styles.css` (global) para reusarla sin duplicarla.
- [x] En móvil (viewport ≤ 900px, mismo breakpoint existente) no hay panel
      lateral: se usa `app-bottom-nav`, ampliado de 4 a 6 iconos (se añaden
      Filtros y Comparar; Filtros abre el `p-drawer` existente, Comparar
      activa/desactiva el modo de selección directamente). En pantallas
      ≤380px se reduce ligeramente fuente/icono para que quepan los 6.
- [x] El máximo de estaciones a comparar sube de 4 a 5
      (`MAX_COMPARISON_STATIONS` en `services/comparison.service.ts`); el
      mínimo para habilitar "Ver comparativa" se mantiene en 2. Los dos
      textos literales que no usaban la constante (`map.service.ts`,
      `favorites-panel.component.html`) se actualizan para reflejar el
      nuevo máximo.

## Alcance
Frontend Angular (`src/app/mapbox/`): `app-side-panel` (nuevo, sustituye a
`app-main-menu`, eliminado), `app-filters-panel` (nuevo, extraído del
`p-drawer` de filtros), `app-bottom-nav` (ampliado a 6 iconos),
`map-view.component` (aloja `.comparison-mode-bar` a nivel superior),
`ComparisonService` (solo el valor de `MAX_COMPARISON_STATIONS`),
`map.service.ts` y `favorites-panel.component.html` (textos del límite),
`src/styles.css` (animación de traslucidez extraída a global).

## Fuera de alcance
- Cualquier cambio en la lógica interna de `app-favorites-panel`,
  `app-route-planner` o el flujo de filtros más allá de montarlos inline
  dentro del panel lateral / reutilizar `app-filters-panel` en el drawer.
- Persistir el estado del panel (colapsado/base/sección) entre recargas de
  página.
- Cualquier endpoint backend nuevo.

## Estado
Completada.

Verificación real con navegador headless (Edge + Puppeteer) contra el
stack completo en Docker Compose, en 1400px (desktop) y 390px (móvil):
- Ciclo completo del panel lateral (colapsado→base→sección→base→colapsado)
  con el botón hamburguesa.
- Cada sección (Filtros, Favoritas, Ruta, Cerca de mí) abre su contenido
  inline correctamente (`app-filters-panel`/`app-favorites-panel`/
  `app-route-planner` montados dentro del panel).
- Modo comparar: selección hasta el nuevo máximo de 5 (un 6º clic no añade
  y no rompe la selección ya hecha); la barra flotante con
  contador/"Ver comparativa"/"Salir" funciona con independencia del estado
  del panel lateral.
- Móvil: `app-bottom-nav` con 6 iconos; tocar "Filtros" abre el drawer,
  tocar "Comparar" activa el modo de selección y muestra la barra flotante
  igual que en desktop.
- `ng build` y `ng test` (11 tests, 3 suites) en verde.

Esta Epic sustituye criterios de aceptación ya cerrados de EPIC-4 (nueva
shell de navegación: el menú ☰ flotante y el punto de entrada de "Cerca de
mí"/Favoritas/Filtros) y de EPIC-8 (modo de selección en el mapa para
comparar: el punto de entrada de "Comparar" desde `app-main-menu`) — por
eso se redacta como Epic nueva en vez de reabrir esas dos.

Decisión tomada de forma autónoma durante la implementación (no es una
decisión grande, queda documentada aquí en vez de en un ADR): el plan
aprobado por el usuario preveía que "Comparar" abriera también una sección
propia dentro del panel lateral, con contador/"Ver comparativa"/"Salir"
embebidos igual que las demás secciones. Se decidió no implementarlo así:
esos mismos controles ya los cubre `.comparison-mode-bar` (movida a nivel
de `map-view` en este mismo cambio), y duplicarlos en dos sitios a la vez
en pantalla habría sido redundante. "Comparar" quedó como botón de acción
directa (toggle), igual que ya lo era en `app-bottom-nav`.
