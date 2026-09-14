#!/usr/bin/env bash
# Sustituye a `airflow standalone`: ese comando genera su propia contraseña
# aleatoria para el usuario admin e ignora _AIRFLOW_WWW_USER_USERNAME/PASSWORD
# (verificado: la contraseña real solo aparece en el log "Login with
# username: admin  password: ..."), lo que rompe la autenticación básica que
# necesita el backend para llamar a la REST API con credenciales predecibles.
#
# Este script replica el resto del comportamiento de `standalone` (un único
# contenedor, LocalExecutor, sin triggerer/Celery/Redis — ver ADR-2) pero
# fijando el usuario admin con las credenciales de _AIRFLOW_WWW_USER_*.
set -euo pipefail

airflow db migrate

# `airflow users create` no actualiza la contraseña de un usuario que ya
# existe (verificado: falla en silencio y deja la contraseña vieja) — algo
# que puede pasar en cualquier reinicio del contenedor mientras el volumen
# de Postgres persiste, no solo en un primer arranque. Se borra primero
# para que sea idempotente de verdad.
airflow users delete --username "${_AIRFLOW_WWW_USER_USERNAME:-admin}" 2>/dev/null || true
airflow users create \
    --username "${_AIRFLOW_WWW_USER_USERNAME:-admin}" \
    --password "${_AIRFLOW_WWW_USER_PASSWORD:-admin}" \
    --firstname Admin --lastname User --role Admin \
    --email admin@example.com

airflow scheduler &
exec airflow webserver
