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
- [ ] Nuevo servicio `frontend` añadido al `docker-compose.yml` único del
      proyecto, basado en una imagen nginx que sirve el resultado de
      `ng build --configuration production`.
- [ ] El servicio expone el puerto configurado por variable de entorno
      (prefijo `VITE_*`/el que corresponda al bundler de Angular ya en uso),
      documentada en `.env.example`.
- [ ] `docker compose up` levanta el frontend junto al resto de servicios sin
      pasos manuales adicionales, y la app resultante funciona igual que con
      `ng serve` (mismo comportamiento funcional, sin regresiones).
- [ ] El README y/o `docs/adr` reflejan que la limitación previa (frontend
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
Propuesta
