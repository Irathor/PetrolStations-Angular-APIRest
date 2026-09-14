"""API de Gasolineras de España — Tali'Zorah se encarga de que estos datos tengan un buen hogar."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .dependencies import solr
from .routers import admin, facets, oil_stations
from .schema import ensure_schema

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # (EPIC-2) La ingesta ya no la dispara un scheduler dentro de este
    # proceso (APScheduler): la orquesta el DAG `gasolineras_ingestion` en
    # Airflow, ver ADR-2. Este backend solo asegura el schema de Solr al
    # arrancar y expone /api/admin/reindex + /api/admin/status.
    await ensure_schema(settings.solr_url, settings.solr_collection)
    yield
    await solr.aclose()


app = FastAPI(title="Gasolineras API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(facets.router)
app.include_router(oil_stations.router)
