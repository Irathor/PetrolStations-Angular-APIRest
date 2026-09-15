# EPIC-7: Frontend en Docker (nginx) para producción

## Historia de usuario
Como responsable del despliegue, quiero poder levantar el frontend con
`docker compose up` igual que el resto de servicios, para no depender de
`ng serve` fuera de Docker en un despliegue real.

## Tipo
Normal

## Bloqueada por
Ninguna

## Criterios de aceptación
- [x] Nuevo servicio `frontend` añadido al `docker-compose.yml` único del
      proyecto, basado en una imagen nginx que sirve el resultado de
      `ng build --configuration production`.
- [x] El servicio expone el puerto configurado por variable de entorno
      (`FRONTEND_PORT`, sin prefijo `VITE_*` — ver nota de alcance abajo),
      documentada en `.env.example`.
- [x] `docker compose up` levanta el frontend junto al resto de servicios sin
      pasos manuales adicionales, y la app resultante funciona igual que con
      `ng serve` (mismo comportamiento funcional, sin regresiones).
- [x] El README y/o `docs/adr` reflejan que la limitación previa (frontend
      solo vía `ng serve` fuera de Docker) queda resuelta.

## Alcance
Infraestructura de despliegue (Garrus): `Dockerfile` multi-stage para el
frontend (build Angular + nginx), entrada correspondiente en
`docker-compose.yml`, variables en `.env.example`.

## Fuera de alcance
- HTTPS/certificados, CDN, gestión de secretos más allá de `.env`,
  observabilidad real — cubierto en la sección "Antes de un despliegue de
  producción real" de `~/.claude/CLAUDE.md`, no se activa hasta que el
  usuario señale que el despliegue real está cerca.

## Estado
Completada.

Nota de alcance: `FRONTEND_PORT` se usó sin el prefijo `VITE_*` que sugería
originalmente la Epic — ese prefijo es para variables que un bundler tipo
Vite lee en tiempo de compilación (`import.meta.env`); el puerto expuesto
aquí es solo el mapeo de Docker Compose (host→contenedor), una variable de
infraestructura pura sin relación con el build de Angular.

Verificación de cierre (2026-09-15): stack completo (`postgres`+`solr`+
`airflow`+`backend`+`frontend`) levantado con `docker compose up -d --build`,
ingesta real disparada. App verificada en navegador real sirviéndose
**íntegramente desde el contenedor nginx** (sin `ng serve` de por medio):
mapa con clustering renderizando datos reales, popup de estación, y la
ruta anidada `/api/oil-stations/{id}/price-history` (la misma que expuso
el bug del proxy de Angular en EPIC-6) funcionando correctamente a través
del proxy de nginx. `pytest` backend 40/40 en verde (sin cambios de
backend en esta Epic). `security-review` no aplica — cambios puramente de
infraestructura, sin auth/datos sensibles/dependencias nuevas con acceso a
datos.

**Dos bugs reales encontrados y arreglados en esta verificación** (además
de un `.dockerignore` que ya encontró y arregló Garrus en su propia
verificación):
1. `proxy_pass $backend_upstream/api/;` en `docker/frontend/nginx.conf`
   duplicaba el prefijo `/api/` contra el backend (`/api/api/facets` en
   vez de `/api/facets`, 404 en absolutamente todas las llamadas a la
   API) — causa: cuando `proxy_pass` usa una variable, nginx **no** hace
   el reemplazo habitual del prefijo de `location` por el path de
   `proxy_pass`, así que ese `/api/` explícito se sumaba a la URI
   original en vez de sustituirla. Corregido quitando el path fijo
   (`proxy_pass $backend_upstream;`), dejando que la URI original (que ya
   incluye `/api/...`) llegue intacta.
2. El mapa se quedaba completamente en negro (sin calles, sin clusters,
   solo el marcador DOM del usuario) porque el `mime.types` por defecto
   de nginx no incluye `.mjs`, así que `maplibre-gl-worker.mjs` se servía
   como `application/octet-stream` — con ese Content-Type los navegadores
   rechazan instanciar el web worker de MapLibre como módulo, y sin él no
   hay renderizado GL de ningún tipo (aunque el resto de la app siguiera
   funcionando, sin errores de consola visibles). Corregido con un
   `location ~* \.mjs$ { default_type application/javascript; }` acotado
   solo a esa extensión (deliberadamente no se usó un bloque `types { }`
   a nivel `server`, que habría reemplazado toda la tabla de mime.types
   heredada del bloque `http` y roto el Content-Type de CSS/imágenes/etc.
   para todo el servidor).

Ninguno de los dos bugs era detectable sin levantar el contenedor real y
probarlo en un navegador de verdad — ambos "funcionaban" en el sentido de
que la petición HTTP devolvía 200, sin errores de red obvios.
