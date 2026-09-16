# Gasolineras de España (FuelFinder)

Aplicación web (nombre de marca: **FuelFinder**) que muestra en un mapa las
gasolineras de España y sus precios, con filtros por provincia, marca, precio
y radio de búsqueda, favoritos, planificador de ruta con ahorro estimado,
comparador de gasolineras e histórico de precios por estación.

Los datos vienen de la
[API REST de gasolineras del Ministerio para la Transición Ecológica](https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help),
que se ingesta una vez al día y se indexa en Apache Solr — la app nunca llama a
esa API directamente desde el navegador (es inestable y lenta).

**Sin dependencias de pago ni tokens que gestionar**: el mapa usa
[MapLibre GL JS](https://maplibre.org/) (open-source) con el estilo gratuito de
[OpenFreeMap](https://openfreemap.org), el buscador de lugares usa
[Photon](https://photon.komoot.io/) (geocoder de OpenStreetMap) y las rutas usan
el [servidor de demostración de OSRM](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).
Ninguno de los tres requiere API key.

## Arquitectura

```
                Airflow: DAG gasolineras_ingestion, 10:00 diario
             (extract_raw → dbt_run → dbt_test → load_to_solr → poda)
                         │
                         ▼
              API del Gobierno (gasolineras)
                         │
                         ▼
                 ┌───────────────┐
                 │Postgres (Docker)│ ◄── raw/staging/marts, transformaciones dbt
                 └───────┬───────┘
                         │  mart stations_current
                         ▼
                 ┌───────────────┐
                 │  Solr (Docker) │ ◄── consultas de lectura
                 └───────▲───────┘
                         │
                 ┌───────┴───────┐
                 │ Backend FastAPI│ ◄── Frontend Angular (HTTP, vía proxy /api)
                 └───────────────┘        servido por nginx en Docker (EPIC-7)
                                           o por `ng serve` en desarrollo
```

- **Frontend**: Angular, servido en producción por nginx dentro de Docker (`docker/frontend/nginx.conf`, ver EPIC-7) o por `ng serve` en desarrollo; en ambos casos habla solo con el backend propio (`/api/...`), nunca con Solr ni Airflow directamente.
- **Backend**: FastAPI. Expone una API REST limpia (GeoJSON); `POST /api/admin/reindex` dispara el DAG de Airflow vía su REST API, `GET /api/admin/status` lee el resultado de la última ejecución desde Postgres — ver "La ingesta diaria" más abajo.
- **Airflow**: orquesta el pipeline de ingesta (extract → dbt run → dbt test → load a Solr → poda → registro del resultado) en modo standalone (`LocalExecutor`, un único contenedor) — ver ADR-2 en `docs/adr/`.
- **Postgres**: capa de datos relacional (esquema `gasolineras`) con las transformaciones raw → staging → marts gestionadas por dbt (ver ADR-1 en `docs/adr/`); Solr se alimenta del mart final, y el historial de ejecuciones de la ingesta (`gasolineras.ingestion_runs`) también vive aquí (ver ADR-2). También aloja los metadatos de Airflow, en el esquema `airflow`.
- **Solr**: almacena las gasolineras; se consulta con faceting (provincia/marca) y filtros geoespaciales (radio).

## Stack

| Capa      | Tecnología |
|-----------|------------|
| Frontend  | Angular 21, PrimeNG 21 (tema Aura), MapLibre GL JS |
| Backend   | Python 3.12, FastAPI, httpx, psycopg |
| Datos     | Apache Solr 9.2, Postgres 16 + dbt |
| Orquestación | Apache Airflow 2.10.4 (standalone, `LocalExecutor`) |
| Infra     | Docker Compose |

`tsconfig.json` usa `"moduleResolution": "bundler"` + `"module": "preserve"`
(el par recomendado por Angular para el builder de esbuild: deja que sea el
bundler, no `tsc`, quien decida cómo tratar los `import`/`export`) y tiene
`noUnusedLocals`/`noUnusedParameters` activados para detectar código muerto.

## Puesta en marcha

### Con Docker (recomendado)

```bash
docker compose up -d --build
```

Esto levanta Postgres, Solr, Airflow, el backend y el frontend (servido con
nginx a partir de `ng build --configuration production`, ver
`Dockerfile.frontend`). Solr arranca **vacío**: la primera vez hay que
disparar la ingesta a mano (después, el DAG diario de Airflow se encarga
solo):

```bash
curl -X POST http://localhost:8001/api/admin/reindex
```

Airflow expone su UI en `http://localhost:8080` (usuario/contraseña por
defecto `admin`/`admin` en desarrollo — cambiar `AIRFLOW_API_USERNAME`/
`AIRFLOW_API_PASSWORD` en el `.env` antes de cualquier despliegue real).

El frontend queda disponible en `http://localhost:4200` (configurable con
`FRONTEND_PORT` en `.env`, ver `.env.example`) y proxya `/api/*` al backend
internamente (`docker/frontend/nginx.conf`), igual que hace `ng serve` en
desarrollo — el navegador nunca necesita CORS ni hablar directo con Solr.

Con esto, `docker compose up -d --build` ya deja la app entera funcionando
(EPIC-7) — **ya no hace falta `ng serve` para tener todo operativo**; solo
se usa en desarrollo del frontend, ver más abajo.

### Frontend (desarrollo, sin Docker)

```bash
npm install
npm start          # ng serve, en http://localhost:4200
```

El `proxy.conf.json` reenvía `/api/*` a `http://localhost:8001` (el backend en
Docker), así que el navegador nunca necesita CORS ni hablar directo con Solr.

### Variables de entorno del backend

Copiar `backend/.env.example` a `backend/.env` y ajustar si hace falta
(cuando se usa `docker compose`, las variables ya vienen fijadas en
`docker-compose.yml` y no hace falta el `.env`):

| Variable | Descripción | Por defecto |
|---|---|---|
| `SOLR_URL` | URL base de Solr | `http://localhost:8983` |
| `SOLR_COLLECTION` | Nombre del core/colección | `oilStations` |
| `CORS_ORIGINS` | Orígenes permitidos | `["http://localhost:4200"]` |
| `ADMIN_TOKEN` | Si se define, protege `POST /api/admin/reindex` (cabecera `X-Admin-Token`) | sin definir (endpoint abierto) |
| `POSTGRES_HOST` | Host de Postgres (capa de datos dbt) | `localhost` |
| `POSTGRES_PORT` | Puerto de Postgres | `5432` |
| `POSTGRES_USER` | Usuario de Postgres | `gasolineras` |
| `POSTGRES_PASSWORD` | Contraseña de Postgres | `gasolineras` |
| `POSTGRES_DB` | Base de datos de Postgres | `gasolineras` |
| `AIRFLOW_BASE_URL` | URL base de la REST API de Airflow, usada por `POST /api/admin/reindex` | `http://localhost:8080` |
| `AIRFLOW_API_USERNAME` | Usuario para autenticarse contra la REST API de Airflow | `admin` |
| `AIRFLOW_API_PASSWORD` | Contraseña para autenticarse contra la REST API de Airflow | `admin` |
| `ALERT_WEBHOOK_URL` | Opcional. Webhook entrante (Discord o Slack) al que el DAG de Airflow notifica si el pipeline falla | sin definir (solo se loggea el fallo) |

Variables del `.env.example` de la raíz (usadas por `docker-compose.yml`,
incluye las compartidas de arriba):

| Variable | Descripción | Por defecto |
|---|---|---|
| `FRONTEND_PORT` | Puerto de host donde se expone el frontend (nginx) | `4200` |

## API del backend

- `GET /api/oil-stations` — gasolineras en GeoJSON. Parámetros opcionales: `provincias`, `estaciones` (repetibles), `precio_min`, `precio_max`, `combustible` (`gasoleo_a` | `gasoleo_premium` | `gasolina_95` | `gasolina_98`, por defecto `gasoleo_a` — sobre qué precio aplica el rango), y `lat`+`lon`+`radius_km` para buscar por radio (además ordena por cercanía).
- `GET /api/oil-stations/{id}/price-history` — serie temporal de precios por combustible de una estación, leída de `gasolineras.fct_station_prices_history` (Postgres). Devuelve 200 con `history: []` si la estación existe pero no tiene histórico todavía (alta reciente), y 404 si el `id` no existe.
- `GET /api/facets` — listas de provincias/marcas para los filtros (cacheado en memoria, se invalida solo tras cada ingesta).
- `GET /api/health` — healthcheck.
- `GET /api/admin/status` — resultado de la última ejecución del pipeline de ingesta (éxito/fallo, cuántas gasolineras se indexaron/podaron, y el último error si lo hay), leído de `gasolineras.ingestion_runs` en Postgres.
- `POST /api/admin/reindex` — encola una ejecución manual del DAG de Airflow (protegido por `ADMIN_TOKEN` si está configurado). Como Airflow ejecuta el DAG de forma asíncrona, la respuesta solo confirma que se ha lanzado (`dag_run_id` + `status`); el resultado real se consulta después con `GET /api/admin/status`.

## La ingesta diaria

La orquesta Airflow (modo standalone, un único contenedor) con el DAG
`gasolineras_ingestion` (`airflow/dags/gasolineras_ingestion.py`), programado
a las 10:00 todos los días — ver ADR-2 en `docs/adr/` para el detalle
completo. Sus tareas, encadenadas:

1. **`extract_raw`** — descarga el dump de la API del Gobierno y lo aterriza tal cual en `gasolineras.raw_stations` (Postgres).
2. **`dbt_run`** — ejecuta los modelos dbt (`staging` → `marts`), incluido el mart `stations_current`.
3. **`dbt_test`** — corre los tests de calidad de dbt (rangos de precio, nulos, unicidad...). Si falla, la cadena se detiene aquí: los datos malos nunca llegan a Solr.
4. **`load_to_solr`** — lee `stations_current` de Postgres y hace upsert en Solr.
5. **`prune_stale_in_solr`** — borra de Solr las gasolineras que ya no aparecen en la fuente. **Nunca deja el índice vacío**: al ir después del upsert, en el peor caso se ve alguna estación obsoleta de más durante unos segundos, nunca un mapa sin datos.
6. **`record_run_status`** — se ejecuta siempre (incluso si alguna tarea anterior falló) y escribe el resultado en `gasolineras.ingestion_runs`, que consulta `GET /api/admin/status`.

Reintentos con backoff exponencial a nivel de DAG (3 intentos, 5 min inicial,
hasta 30 min máximo). Si el DAG falla, se registra siempre un log `ERROR`
identificable, y opcionalmente se notifica a un webhook entrante (Discord o
Slack) si se configura `ALERT_WEBHOOK_URL` — ver ADR-3 en `docs/adr/`.

## Funcionalidades

### Navegación (panel lateral, EPIC-9 — sustituye al rediseño de EPIC-4)

- **Escritorio (> 900px): panel lateral persistente** (`app-side-panel`), a la
  izquierda, con tres estados: colapsado (riel de iconos cuadrados, sin
  texto), base (columna de botones icono+texto) y sección abierta (el panel
  se ensancha y muestra el contenido inline, sin `p-dialog`/`p-drawer`
  aparte). El icono de la app hace de botón de colapsar/expandir. Aloja
  también lo que antes vivía en la app bar: buscador de lugares, selector de
  combustible ("Filtra por tipo de combustible"), centrar mapa y cambiar
  tema — estos dos últimos alineados junto al logo. Mide el 90% del alto de
  la página, centrado en vertical, y se atenúa tras 3s de inactividad
  (recupera opacidad al pasar el ratón), igual que hacía la app bar antes.
- **Móvil (≤ 900px): app bar superior clásica** (logo, buscador, combustible,
  centrar mapa, tema) + **bottom navigation de 6 accesos** (Explorar / Cerca
  de mí / Favoritas / Ruta / Filtros / Comparar) — no hay panel lateral en
  este viewport.
- **Filtros**: mismo componente (`app-filters-panel`) reutilizado en dos
  sitios sin duplicar plantilla — sección inline del panel lateral en
  desktop, `p-drawer` (desde abajo) en móvil — con badge del nº de filtros
  activos.
- **Comparador**: modo de selección directo sobre el mapa (clic en un
  marcador lo añade/quita, con resaltado visual), activado desde el panel
  lateral o el bottom nav; una barra flotante muestra el contador, "Ver
  comparativa" y "Salir".
- **Card de popup de estación**: chip del color de la marca junto al nombre,
  dirección, precio destacado, badge de abierta/cerrada, distancia, y los
  botones "Ver evolución de precios"/"Cómo llegar" — precio y botones toman
  el mismo color que el chip (con el contraste ajustado automáticamente si
  el tono de marca no es legible tal cual sobre el fondo oscuro, ver
  `utils/brand-colors.ts` y `utils/color.ts`). El popup del mapa siempre se
  pinta por encima del panel lateral, para no perderlo de vista si coincide
  con él en pantalla.

### Funciones sobre el mapa

- **Buscador de lugares** (Photon/OpenStreetMap): escribe una dirección o topónimo, la lista de resultados permite centrar el mapa en el lugar (fly-to) o trazar ruta desde la posición del usuario hasta él directamente, sin pasar por el popup de una gasolinera.
- **Mapa con clustering nativo de MapLibre GL** (no un marcador DOM por gasolinera — con ~11.500 estaciones eso es lo que colapsaba el navegador en la versión original). Los clusters muestran el nº de gasolineras y el precio medio del combustible seleccionado, en texto blanco y negrita (`text-font: ['Noto Sans Bold']` — hay que fijarlo explícitamente porque el servidor de glifos de OpenFreeMap no sirve el fallback por defecto de MapLibre).
- **Filtros** por provincia, marca, combustible y rango de precio, combinables entre sí. El combustible elegido determina sobre qué precio filtra, el precio medio de los clusters, y qué gasolinera cuenta como "más barata en ruta".
- **"Cerca de mí"**: filtra por radio configurable (2/5/10/25/50 km) alrededor de la posición del usuario (o de Madrid, si no se pudo geolocalizar — ver abajo).
- **Favoritas**: se marcan desde el popup de cada gasolinera (★), guardadas en `localStorage` del navegador (no requieren backend ni login — ver "Limitaciones conocidas"). El panel de Favoritas (menú flotante) muestra, por cada guardada, nombre, precio del combustible seleccionado, distancia y si está abierta/cerrada; click centra el mapa en ella.
- **Horario**: el popup de cada gasolinera muestra si está abierta ahora mismo, interpretando el campo `Horario` de la API del Gobierno (cubre los formatos "24h" y "incluye un rango, mismo horario todos los días"; si el formato es más complejo se muestra el texto tal cual).
- **Fallback de geolocalización**: si se deniega el permiso o el navegador no la soporta, la app centra en Madrid en vez de quedarse bloqueada en la pantalla de carga, con un aviso visible que se desvanece solo a los 5 segundos (`fadeOutLocationNotice` en `map-view.component.css`) para no quedar estorbando de forma permanente.
- **Filtros recordados**: provincia, marca, precio y combustible se guardan en `localStorage` y se restauran en la siguiente visita.
- **Feedback de carga y de "sin resultados"**: spinner mientras se pide al backend, aviso si una combinación de filtros no devuelve ninguna gasolinera.
- **Mapa oscuro o normal**: alterna entre el estilo oscuro de OpenFreeMap y su estilo "liberty" (colores clásicos de mapa), sin perder las gasolineras ya cargadas ni la posición del mapa. La elección se recuerda en `localStorage`.
- **Responsive mobile-first**: panel lateral (desktop) / app bar + bottom nav (móvil) y drawer de filtros se adaptan al viewport (ver "Navegación" arriba).

### Planificador de ruta avanzado (EPIC-5)

Introduce origen, destino (buscador Photon), combustible y desvío máximo
admitido (configurable, antes fijo a 2 km); opcionalmente la capacidad del
depósito. Encuentra la gasolinera más barata en el trayecto y estima el
ahorro real: precio × litros menos el coste estimado del combustible extra
consumido en el desvío (asumiendo un consumo de referencia de ~7 L/100 km),
con aviso explícito de que es una estimación, no el consumo real del
vehículo.

### Comparador de gasolineras (EPIC-5, modo de selección desde EPIC-8/EPIC-9)

Selecciona entre 2 y 5 estaciones (modo de selección en el mapa, o desde
Favoritas) y muestra una tabla comparativa con precio de los 4 combustibles,
distancia, horario (abierta/cerrada) y coste de viaje cuando aplica,
destacando la opción más barata.

### Histórico de precios (EPIC-6)

El botón "Ver evolución de precios" del popup de estación abre un diálogo
con un gráfico de línea (Chart.js vía `p-chart` de PrimeNG) de la evolución
del precio por combustible, más un resumen textual accesible (precio actual,
precio hace N días, mínimo/máximo). Si la estación no tiene histórico
disponible (alta reciente), se indica de forma clara en vez de mostrar un
gráfico vacío o un error. Los datos vienen de
`GET /api/oil-stations/{id}/price-history`, que lee del mart
`gasolineras.fct_station_prices_history` (Postgres, histórico SCD-2 desde
EPIC-1).

## Rendimiento

- **Backend**: `SolrClient` mantiene un único `httpx.AsyncClient` (con *keep-alive*)
  durante todo el ciclo de vida del proceso en vez de abrir una conexión nueva
  en cada petición — se nota sobre todo en `/api/oil-stations` y `/api/facets`,
  que se llaman en cada cambio de filtro.
- **Frontend**: sin `BrowserAnimationsModule` (ni el código propio ni PrimeNG 21
  lo necesitan — PrimeNG usa transiciones CSS), `HttpClient` con `withFetch()`
  (Fetch API en vez de XHR) y `eventCoalescing: true` en la detección de
  cambios (recomendación oficial de Angular para agrupar eventos DOM en un
  solo ciclo). El bundle inicial ronda los 2 MB (~430 KB transferidos con
  compresión), la mayor parte MapLibre GL + PrimeNG.

## Tests

**Frontend** (Jest, vía el builder oficial de Angular):
```bash
npm test
```

**Backend** (pytest, sin necesidad de Docker/Solr — son tests unitarios de la lógica de transformación e filtros):
```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # o source .venv/bin/activate en Linux/Mac
pip install -r requirements-dev.txt
pytest
```

## CI

`.github/workflows/ci.yml` compila y testea el frontend, corre los tests del
backend, y comprueba que `docker compose build` funciona — en cada push/PR.

## Seguridad

- No hay ningún API key de terceros en el frontend — MapLibre/OpenFreeMap,
  Photon y OSRM son gratuitos y sin token. Si en el futuro se añade algún
  proveedor que sí requiera clave, que no se comitee a un repo público (usar
  variables de entorno inyectadas en build).
- `POST /api/admin/reindex` puede protegerse con `ADMIN_TOKEN` (ver tabla de
  variables de entorno arriba) — sin configurar, cualquiera con acceso a la
  red puede disparar una reindexación manual.

## Limitaciones conocidas / ideas para seguir

- **Photon y el servidor de demo de OSRM son servicios públicos de uso
  razonable**, no pensados para tráfico de producción intenso — no dan
  garantías de disponibilidad ni límite de peticiones documentado más allá
  de "no abuses". Si el proyecto creciera en uso real, lo correcto sería
  auto-alojar ambos (ambos son open-source) o pasar a un proveedor con SLA.
- El worker interno de MapLibre necesita `prebundle.exclude` en la config del
  dev-server de Angular (`angular.json`, target `serve`) y que su `.mjs` se
  copie como asset (`maplibre-gl-worker.mjs` / `maplibre-gl-shared.mjs`) — sin
  eso, el mapa carga el estilo pero no pinta nada (pantalla en negro). Si se
  actualiza `maplibre-gl` de versión mayor, conviene volver a comprobar que
  esos nombres de fichero no hayan cambiado.
- El builder `@angular-devkit/build-angular:jest` usado para los tests del
  frontend está marcado como **experimental** por Angular y se retirará en la
  v22 — habrá que revisar qué lo sustituye cuando se actualice el proyecto.
- La ingesta evita el mapa vacío con upsert+poda, pero sigue siendo un único
  proceso: si se necesitara más robustez (varias réplicas, SolrCloud), lo
  correcto sería un alias de colección con swap atómico en vez de upsert.
- El caché en memoria de `GET /api/facets` ya no se invalida automáticamente
  al terminar una ingesta (antes de EPIC-2, `run_ingestion()` corría en el
  mismo proceso que el backend y podía limpiarlo directamente; ahora la
  ingesta corre en el contenedor de Airflow, un proceso separado). Hoy solo
  se invalida al reiniciar el backend — ver nota en
  `backend/app/routers/facets.py` y `docs/BACKLOG.md`.
- **Sin sistema de cuentas/login**: favoritos y comparación son anónimos vía
  `localStorage`, no se sincronizan entre dispositivos ni permiten alertas de
  precio personalizadas — decisión explícita para este rediseño, ver
  `docs/BACKLOG.md` (sección Niebla).
- **Sin capas de mapa de pago** (satélite/tráfico): no existe alternativa
  gratuita sin token compatible con MapLibre+OpenFreeMap — ver
  `docs/BACKLOG.md` (sección Fuera de alcance).

Más detalle de decisiones y fast-follows pendientes en `docs/BACKLOG.md`,
las 7 Epics del proyecto en `docs/epics/` y los ADR en `docs/adr/`.
