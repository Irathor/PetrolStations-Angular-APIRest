"""Tests de GET /api/oil-stations/{id}/price-history (EPIC-6): 404 si la
estación no existe en Solr, 200 con `history: []` si existe pero no tiene
histórico todavía, y 200 remapeando el mart SCD-2 al vocabulario FuelKey
del frontend (omitiendo combustibles con valor None)."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.routers import oil_stations


def _solr_result(docs: list[dict]) -> dict:
    return {"response": {"docs": docs}}


async def test_price_history_raises_404_when_station_not_in_solr():
    with patch.object(oil_stations.solr, "query", new=AsyncMock(return_value=_solr_result([]))):
        with pytest.raises(HTTPException) as exc_info:
            await oil_stations.get_oil_station_price_history("does-not-exist")

    assert exc_info.value.status_code == 404


async def test_price_history_returns_empty_list_when_station_exists_without_history():
    with patch.object(oil_stations.solr, "query", new=AsyncMock(return_value=_solr_result([{"id": "12345"}]))):
        with patch.object(oil_stations, "fetch_price_history", new=AsyncMock(return_value=[])):
            result = await oil_stations.get_oil_station_price_history("12345")

    assert result == {"id": "12345", "history": []}


async def test_price_history_maps_mart_rows_to_fuel_key_vocabulary():
    valid_from_1 = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)
    valid_from_2 = datetime(2026, 9, 5, 10, 0, tzinfo=timezone.utc)

    mart_rows = [
        {
            "ideess": "12345",
            "precio_gasoleo_a": 1.749,
            "precio_gasoleo_b": 1.6,  # sin FuelKey: no debe aparecer en la respuesta
            "precio_gasoleo_premium": 1.849,
            "precio_gasolina_95_e5": 1.699,
            "precio_gasolina_98_e5": None,  # None: se omite la clave, no se manda null
            "valid_from": valid_from_1,
            "valid_to": valid_from_2,
            "is_current": False,
        },
        {
            "ideess": "12345",
            "precio_gasoleo_a": 1.759,
            "precio_gasoleo_b": 1.61,
            "precio_gasoleo_premium": 1.859,
            "precio_gasolina_95_e5": 1.709,
            "precio_gasolina_98_e5": 1.809,
            "valid_from": valid_from_2,
            "valid_to": None,
            "is_current": True,
        },
    ]

    with patch.object(oil_stations.solr, "query", new=AsyncMock(return_value=_solr_result([{"id": "12345"}]))):
        with patch.object(oil_stations, "fetch_price_history", new=AsyncMock(return_value=mart_rows)):
            result = await oil_stations.get_oil_station_price_history("12345")

    assert result["id"] == "12345"
    assert len(result["history"]) == 2

    first, second = result["history"]

    assert first["valid_from"] == valid_from_1
    assert first["valid_to"] == valid_from_2
    assert first["is_current"] is False
    assert first["precios"] == {
        "gasoleo_a": 1.749,
        "gasoleo_premium": 1.849,
        "gasolina_95": 1.699,
    }
    assert "gasolina_98" not in first["precios"]
    assert "gasoleo_b" not in str(first["precios"].keys())

    assert second["valid_to"] is None
    assert second["is_current"] is True
    assert second["precios"] == {
        "gasoleo_a": 1.759,
        "gasoleo_premium": 1.859,
        "gasolina_95": 1.709,
        "gasolina_98": 1.809,
    }
