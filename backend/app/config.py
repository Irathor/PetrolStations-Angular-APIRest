from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración del backend, sobrescribible por variables de entorno (ver docker-compose.yml)."""

    solr_url: str = "http://localhost:8983"
    solr_collection: str = "oilStations"

    # Variables compartidas (sin prefijo, ver ~/.claude/CLAUDE.md) con el
    # servicio `postgres` de docker-compose.yml. Los defaults coinciden con
    # los defaults de ese servicio para que `docker compose up` funcione sin
    # un .env explícito.
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "gasolineras"
    postgres_password: str = "gasolineras"
    postgres_db: str = "gasolineras"

    gov_api_url: str = (
        "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes"
        "/PreciosCarburantes/EstacionesTerrestres/"
    )

    # Hora local del contenedor a la que se ejecuta la ingesta diaria.
    ingestion_hour: int = 10
    ingestion_minute: int = 0

    cors_origins: list[str] = ["http://localhost:4200"]

    # Si se define, protege POST /api/admin/reindex exigiendo la cabecera
    # X-Admin-Token con este valor. Si se deja vacío, el endpoint queda
    # abierto (aceptable en desarrollo local, no recomendado en producción).
    admin_token: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_nested_delimiter=",")


settings = Settings()
