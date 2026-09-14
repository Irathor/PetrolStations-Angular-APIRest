-- Esquemas lógicos dentro de la base de datos compartida ${POSTGRES_DB}.
-- gasolineras: datos de la aplicación (raw/staging/marts de dbt, ver EPIC-1).
-- airflow: metadatos de Airflow (se usará en EPIC-2, se crea ya para no
-- tener que volver a tocar este script de inicialización).
CREATE SCHEMA IF NOT EXISTS gasolineras;
CREATE SCHEMA IF NOT EXISTS airflow;
