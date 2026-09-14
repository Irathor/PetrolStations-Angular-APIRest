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
- [x] Nuevo job en `.github/workflows/ci.yml` que corre `pip-audit` sobre
      `backend/requirements.txt` (y `requirements-dev.txt` si aplica).
- [x] Nuevo job (o extensión del job `frontend` existente) que corre
      `npm audit` sobre el frontend.
- [x] Ambos jobs corren en cada push/PR, igual que los jobs existentes
      (`frontend`, `backend`, `docker-build`).

## Alcance
Solo `.github/workflows/ci.yml`.

## Fuera de alcance
Arreglar automáticamente las vulnerabilidades que se encuentren — se evalúa
caso a caso cuando el escaneo las reporte, no es parte de este Epic.

## Estado
Completada.

## Nota de verificación
- Verificado el paquete `pip-audit` en PyPI antes de fijarlo: existe, versión
  actual 2.10.1 (el job no fija versión concreta, instala la última).
- Se validó la sintaxis YAML de `.github/workflows/ci.yml` con
  `yaml.safe_load` (Python) tras el cambio: correcta.
- Se ejecutó `pip-audit` de verdad, localmente, contra `backend/requirements.txt`
  y `backend/requirements-dev.txt`: encontró vulnerabilidades conocidas reales
  (`starlette 0.41.3` con 8 CVEs/PYSEC distintos, fix disponible en 0.47.2+;
  `pytest 8.3.4` con PYSEC-2026-1845, fix en 9.0.3). No se han corregido —
  arreglarlas es explícitamente fuera de alcance de esta Epic; queda anotado
  aquí para que se evalúe caso a caso.
- Se ejecutó `npm audit --audit-level=high` de verdad, en la raíz del repo:
  exit code 0 (no bloquea), 7 vulnerabilidades moderate (ninguna high) en
  dependencias de tooling de build de Angular (`qs`, `uuid` vía
  `webpack-dev-server`/`@angular-devkit/build-angular`), sin impacto en
  producción. Confirma que `--audit-level=high` es un umbral razonable para
  no generar ruido por vulnerabilidades moderate/low en devDependencies.
- Ambos jobs nuevos (`dependency-scan-backend`, `dependency-scan-frontend`)
  usan `continue-on-error: true`: son informativos, no bloquean el build,
  documentado con comentario en el propio YAML.
