# EPIC-3: Escaneo de dependencias en CI

## Historia de usuario
Como responsable del proyecto, quiero que el pipeline de CI detecte
dependencias con vulnerabilidades conocidas, para no depender de acordarme de
revisarlo manualmente.

## Tipo
Normal.

## Bloqueada por
Ninguna (independiente de EPIC-1 y EPIC-2, se puede implementar en cualquier
momento).

## Criterios de aceptación
- [ ] Nuevo job en `.github/workflows/ci.yml` que corre `pip-audit` sobre
      `backend/requirements.txt` (y `requirements-dev.txt` si aplica).
- [ ] Nuevo job (o extensión del job `frontend` existente) que corre
      `npm audit` sobre el frontend.
- [ ] Ambos jobs corren en cada push/PR, igual que los jobs existentes
      (`frontend`, `backend`, `docker-build`).

## Alcance
Solo `.github/workflows/ci.yml`.

## Fuera de alcance
Arreglar automáticamente las vulnerabilidades que se encuentren — se evalúa
caso a caso cuando el escaneo las reporte, no es parte de este Epic.

## Estado
Propuesta.
