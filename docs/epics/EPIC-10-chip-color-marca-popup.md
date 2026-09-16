# EPIC-10: Chip de color de marca en la tarjeta de estación

## Historia de usuario
Como usuario de la app, quiero identificar de un vistazo la marca de la
estación en la tarjeta (popup) que se abre al pulsar un punto del mapa, sin
depender de logos corporativos de terceros, para reconocer la marca al
mismo tiempo que el resto de la interfaz sigue siendo coherente y libre de
riesgos de propiedad intelectual.

## Tipo
Normal

## Bloqueada por
Ninguna.

## Criterios de aceptación
- [x] La tarjeta de estación muestra un chip circular de 12px junto al
      nombre de la estación, con el mismo color que ya se usa para pintar
      los puntos de esa marca en el mapa (`getBrandColor`), con un anillo
      blanco sutil para que se distinga sobre cualquier fondo.
- [x] El precio destacado y el botón de contorno "Ver evolución de
      precios" adoptan el color de marca como color de texto/borde,
      garantizando un contraste ≥4.5:1 (WCAG) contra el fondo oscuro de la
      tarjeta (`getBrandTextColor`, aclarando el color en HSL cuando el
      color real de marca no llega al umbral).
- [x] El botón relleno "Cómo llegar" usa el color real de marca como fondo
      y elige automáticamente texto blanco u oscuro según cuál tenga más
      contraste contra ese fondo (`getBrandForegroundColor`), para que
      marcas claras (p. ej. Shell) no queden con texto blanco ilegible.
- [x] El color de marca (paleta de 7 marcas + color gris por defecto para
      el resto) vive en un único módulo (`utils/brand-colors.ts`) que
      alimenta tanto los puntos del mapa como el chip/precio/botones de la
      tarjeta, sin mantener dos listas de colores por separado.
- [x] El popup de una estación queda siempre por encima del panel lateral
      de navegación (EPIC-9) y de la barra flotante de modo comparar
      (EPIC-8) cuando coinciden en pantalla, para no perder de vista la
      tarjeta abierta.

## Alcance
Frontend Angular (`src/app/mapbox/`): `utils/color.ts` (nuevo, utilidades
de contraste WCAG y ajuste de luminosidad en HSL), `utils/brand-colors.ts`
(nuevo, fuente única de color por marca), `services/map.service.ts`
(construcción de la expresión de color del mapa a partir de
`brand-colors.ts`, y marcado del chip + custom properties CSS de color en
la tarjeta), `src/styles.css` (estilos del chip, `z-index` del popup, y
color de marca aplicado a precio/botones de la tarjeta).

## Fuera de alcance
- Usar logos corporativos reales de cada marca (Repsol, Cepsa, Shell...)
  en la tarjeta: descartado deliberadamente por riesgo de marca registrada
  (usar logos de terceros sin permiso en un proyecto de portfolio público)
  y por la inconsistencia de tener que localizar y mantener logos de
  decenas de marcas con calidad/formato dispares. El chip de color
  reutiliza información que la app ya tenía (el color de marca de los
  puntos del mapa) sin ese riesgo.
- Editar o ampliar la paleta de marcas reconocidas (las 7 ya existentes +
  color por defecto para el resto); añadir una marca nueva a la paleta
  queda fuera de esta Epic.
- Persistir o hacer configurable el color de marca por el usuario.

## Estado
Completada.

Verificación real con navegador headless (Edge + Puppeteer) contra el
stack completo en Docker Compose: se abrieron tarjetas de estaciones de
distintas marcas y se confirmó visualmente que chip, precio y ambos
botones siguen el color de marca de forma coherente — REPSOL en azul
`#03a9f4`; SHELL en amarillo `#fdd835`, con "Cómo llegar" en fondo
amarillo y texto oscuro por el resultado del cálculo de contraste; una
marca sin mapear ("BLANCA") cae en gris `#9e9e9e` por defecto. Se confirmó
`getComputedStyle(...).zIndex === '30'` en el popup abierto junto al panel
lateral, y visualmente que el popup queda por encima del panel sin quedar
tapado. Un script aparte verificó que las 7 marcas alcanzan ≥4.5:1 de
contraste tras el ajuste de `ensureContrast` (antes del ajuste: GALP
2.30:1, CAMPSA 3.84:1, PETRONOR 4.41:1 — las tres por debajo del umbral;
el resto ya lo cumplía de por sí). `ng build` y `ng test` (11 tests, 3
suites) en verde.

En la misma ronda de cierre se hizo una limpieza general del proyecto (no
forma parte del alcance funcional de esta Epic, pero se completó junto a
ella): eliminación de dos carpetas vacías sin versionar
(`backend/scripts` y una carpeta con nombre corrupto, restos de comandos
anteriores), confirmación de que no hay imports/código muerto en el
backend Python (`pyflakes`) ni `console.log`/`debugger`/`TODO`/`FIXME`
sueltos en el frontend, limpieza de ~287MB de artefactos de build ya
cubiertos por `.gitignore`, y actualización de `README.md` (secciones
"Navegación" y "Comparador de gasolineras", que describían todavía el
diseño anterior a EPIC-9).
