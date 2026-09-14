"""Tests del router de administración tras el cutover a Airflow (EPIC-2):
POST /api/admin/reindex dispara el DAG vía la REST API de Airflow (httpx
mockeado) y GET /api/admin/status lee de Postgres (fetch_latest_ingestion_run
mockeado), en vez del dataclass en memoria de antes de este Epic."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

from app.routers import admin


async def test_trigger_reindex_calls_airflow_dag_runs_api():
    fake_response = MagicMock()
    fake_response.raise_for_status = MagicMock()
    fake_response.json.return_value = {"dag_run_id": "manual__2026-09-14", "state": "queued"}

    with patch.object(httpx.AsyncClient, "post", new=AsyncMock(return_value=fake_response)) as post:
        result = await admin.trigger_reindex()

    assert result.dag_run_id == "manual__2026-09-14"
    assert result.status == "queued"
    post.assert_awaited_once()
    called_url = post.await_args.args[0]
    assert called_url.endswith("/api/v1/dags/gasolineras_ingestion/dagRuns")


async def test_trigger_reindex_raises_502_when_airflow_unreachable():
    with patch.object(
        httpx.AsyncClient, "post", new=AsyncMock(side_effect=httpx.ConnectError("sin conexión"))
    ):
        with pytest.raises(HTTPException) as exc_info:
            await admin.trigger_reindex()

    assert exc_info.value.status_code == 502


async def test_get_ingestion_status_returns_empty_shape_without_runs():
    with patch.object(admin, "fetch_latest_ingestion_run", new=AsyncMock(return_value=None)):
        result = await admin.get_ingestion_status()

    assert result.last_run_success is None
    assert result.last_success_at is None
    assert result.last_error_at is None


async def test_get_ingestion_status_reflects_latest_successful_run():
    finished_at = datetime(2026, 9, 14, 10, 5, tzinfo=timezone.utc)
    run = {
        "run_id": "abc",
        "started_at": datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc),
        "finished_at": finished_at,
        "success": True,
        "source_total": 11510,
        "indexed": 11500,
        "pruned": 3,
        "error": None,
    }

    with patch.object(admin, "fetch_latest_ingestion_run", new=AsyncMock(return_value=run)):
        result = await admin.get_ingestion_status()

    assert result.last_run_success is True
    assert result.last_success_at == finished_at
    assert result.last_error_at is None
    assert result.last_source_total == 11510
    assert result.last_indexed == 11500
    assert result.last_pruned == 3


async def test_get_ingestion_status_reflects_latest_failed_run():
    finished_at = datetime(2026, 9, 14, 10, 5, tzinfo=timezone.utc)
    run = {
        "run_id": "abc",
        "started_at": datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc),
        "finished_at": finished_at,
        "success": False,
        "source_total": 11510,
        "indexed": None,
        "pruned": None,
        "error": "Tareas fallidas o sin completar: dbt_test",
    }

    with patch.object(admin, "fetch_latest_ingestion_run", new=AsyncMock(return_value=run)):
        result = await admin.get_ingestion_status()

    assert result.last_run_success is False
    assert result.last_success_at is None
    assert result.last_error_at == finished_at
    assert result.last_error == "Tareas fallidas o sin completar: dbt_test"
