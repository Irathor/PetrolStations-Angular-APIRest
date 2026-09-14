# Gasolineras de España

Aplicación web que muestra en un mapa las gasolineras de España y sus precios, con
filtros por provincia, marca, precio y radio de búsqueda, favoritos, y cálculo de
la gasolinera más barata en una ruta.

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
                    10:00 diario
                         │
                         ▼
              API del Gobierno (gasolineras)
                         │  ingesta (upsert + poda, ver más abajo)
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
                 │ Backend FastAPI│ ◄── Angular (HTTP, vía proxy /api)
                 └───────────────┘
```

- **Frontend**: Angular, habla solo con el backend propio (`/api/...`), nunca con Solr directamente.
- **Backend**: FastAPI + APScheduler. Expone una API REST limpia (GeoJSON) y ejecuta la ingesta diaria programada.
- **Postgres**: capa de datos relacional (esquema `gasolineras`) con las transformaciones raw → staging → marts gestionadas por dbt (ver ADR-1 en `docs/adr/`); Solr se alimenta del mart final.
- **Solr**: almacena las gasolineras; se consulta con faceting (provincia/marca) y filtros geoespaciales (radio).

## Stack

| Capa      | Tecnología |
|-----------|------------|
| Frontend  | Angular 21, PrimeNG 21 (tema Aura), MapLibre GL JS |
| Backend   | Python 3.12, FastAPI, APScheduler, httpx |
| Datos     | Apache Solr 9.2, Postgres 16 + dbt |
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

Esto levanta Solr y el backend. Solr arranca **vacío**: la primera vez hay que
disparar la ingesta a mano (después, el cron diario se encarga solo):

```bash
curl -X POST http://localhost:8001/api/admin/reindex
```

El frontend no está en el `docker-compose.yml` (se sirve en modo desarrollo con
`ng serve`, ver abajo); si se quiere servir también desde Docker en producción,
habría que añadir un servicio con una imagen nginx sirviendo `ng build --configuration production`.

### Frontend (desarrollo)

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
| `INGESTION_HOUR` / `INGESTION_MINUTE` | Hora local del cron diario | `10:00` |
| `CORS_ORIGINS` | Orígenes permitidos | `["http://localhost:4200"]` |
| `ADMIN_TOKEN` | Si se define, protege `POST /api/admin/reindex` (cabecera `X-Admin-Token`) | sin definir (endpoint abierto) |
| `POSTGRES_HOST` | Host de Postgres (capa de datos dbt) | `localhost` |
| `POSTGRES_PORT` | Puerto de Postgres | `5432` |
| `POSTGRES_USER` | Usuario de Postgres | `gasolineras` |
| `POSTGRES_PASSWORD` | Contraseña de Postgres | `gasolineras` |
| `POSTGRES_DB` | Base de datos de Postgres | `gasolineras` |

## API del backend

- `GET /api/oil-stations` — gasolineras en GeoJSON. Parámetros opcionales: `provincias`, `estaciones` (repetibles), `precio_min`, `precio_max`, `combustible` (`gasoleo_a` | `gasoleo_premium` | `gasolina_95` | `gasolina_98`, por defecto `gasoleo_a` — sobre qué precio aplica el rango), y `lat`+`lon`+`radius_km` para buscar por radio (además ordena por cercanía).
- `GET /api/facets` — listas de provincias/marcas para los filtros (cacheado en memoria, se invalida solo tras cada ingesta).
- `GET /api/health` — healthcheck.
- `GET /api/admin/status` — cuándo fue la última ingesta con éxito, cuántas gasolineras se indexaron/podaron, y el último error si lo hay.
- `POST /api/admin/reindex` — dispara la ingesta manualmente (protegido por `ADMIN_TOKEN` si está configurado).

## La ingesta diaria

Corre dentro del propio proceso del backend (APScheduler), a la hora fijada por
`INGESTION_HOUR`/`INGESTION_MINUTE`. **Nunca borra todo el índice de golpe**:
primero indexa (upsert, por `id`) los datos frescos de la API del Gobierno, y
solo después borra de Solr las gasolineras que ya no aparecen. Así, en el peor
caso, durante los segundos que dura la ingesta se ve alguna estación obsoleta
de más — nunca un mapa vacío.

## Funcionalidades

- **Buscador de lugares** (Photon/OpenStreetMap): escribe una dirección o topónimo, la lista de resultados permite centrar el mapa en el lugar (fly-to) o trazar ruta desde la posición del usuario hasta él directamente, sin pasar por el popup de una gasolinera.
- **Mapa con clustering nativo de MapLibre GL** (no un marcador DOM por gasolinera — con ~11.500 estaciones eso es lo que colapsaba el navegador en la versión original). Los clusters muestran el nº de gasolineras y el precio medio del combustible seleccionado, en texto blanco y negrita (`text-font: ['Noto Sans Bold']` — hay que fijarlo explícitamente porque el servidor de glifos de OpenFreeMap no sirve el fallback por defecto de MapLibre).
- **Filtros** por provincia, marca, combustible y rango de precio, combinables entre sí. El combustible elegido determina sobre qué precio filtra, el precio medio de los clusters, y qué gasolinera cuenta como "más barata en ruta".
- **"Cerca de mí"**: filtra a un radio de 10 km de la posición del usuario (o de Madrid, si no se pudo geolocalizar — ver abajo).
- **Favoritas**: se marcan desde el popup de cada gasolinera (★), guardadas en `localStorage` del navegador (no requieren backend ni login). El botón "Favoritas" del menú filtra el mapa para mostrar solo las guardadas, con un contador.
- **Gasolinera más barata en ruta**: al trazar una ruta (OSRM, botón "Cómo llegar" del popup, con estilo propio en `.directions-btn` de `src/styles.css`) se resalta la gasolinera más barata (según el combustible seleccionado) a menos de 2 km del trayecto.
- **Horario**: el popup de cada gasolinera muestra si está abierta ahora mismo, interpretando el campo `Horario` de la API del Gobierno (cubre los formatos "24h" y "incluye un rango, mismo horario todos los días"; si el formato es más complejo se muestra el texto tal cual).
- **Fallback de geolocalización**: si se deniega el permiso o el navegador no la soporta, la app centra en Madrid en vez de quedarse bloqueada en la pantalla de carga, con un aviso visible que se desvanece solo a los 5 segundos (`fadeOutLocationNotice` en `map-view.component.css`) para no quedar estorbando de forma permanente.
- **Filtros recordados**: provincia, marca, precio y combustible se guardan en `localStorage` y se restauran en la siguiente visita.
- **Feedback de carga y de "sin resultados"**: spinner mientras se pide al backend, aviso si una combinación de filtros no devuelve ninguna gasolinera.
- **Menú superior discreto**: si el ratón lleva 3 segundos fuera del menú de filtros, este se vuelve un 80% transparente (opacidad 0,2) para dejar más protagonismo al mapa, y recupera su opacidad completa en 0,5s en cuanto el ratón vuelve a pasar por encima (`.card` en `map-view.component.css`, con `:hover` + `animation-delay`).
- **Mapa oscuro o normal**: un selector junto a "Favoritas" alterna entre el estilo oscuro de OpenFreeMap y su estilo "liberty" (colores clásicos de mapa), sin perder las gasolineras ya cargadas ni la posición del mapa. La elección se recuerda en `localStorage`.
- **Responsive**: la barra de filtros se adapta (se apila) en pantallas estrechas.

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
- No hay alertas activas si la ingesta diaria falla (solo queda en los logs y
  en `GET /api/admin/status`) — para eso haría falta un canal de notificación
  (email, Slack...) que el proyecto no tiene configurado.
- El responsive es funcional pero básico (la barra de filtros se apila); no
  se ha rediseñado pensando en móvil de cero.
