"""Tests de GET /api/facets: incluye `preciosMaximos` (precio máximo real
por combustible, vía stats component de Solr) junto a `provincias`/
`estaciones`, omitiendo combustibles sin ningún documento con precio en vez
de mandar `null`."""

from unittest.mock import AsyncMock, patch

from app.routers import facets
from app.state import facets_cache


def _solr_result(stats_fields: dict) -> dict:
    return {
        "facet_counts": {
            "facet_fields": {
                "Provincia": ["MADRID", 10, "BARCELONA", 5],
                "Estacion": ["REPSOL", 8],
            }
        },
        "stats": {"stats_fields": stats_fields},
    }


async def test_facets_includes_precios_maximos_for_all_fuels():
    facets_cache.clear()
    solr_result = _solr_result(
        {
            "Precio_Gasoleo_A": {"max": 1.999},
            "Precio_Gasoleo_Premium": {"max": 2.099},
            "Precio_Gasolina_95_E5": {"max": 2.019},
            "Precio_Gasolina_98_E5": {"max": 2.199},
        }
    )

    with patch.object(facets.solr, "query", new=AsyncMock(return_value=solr_result)):
        response = await facets.get_facets()

    assert response.precios_maximos == {
        "gasoleo_a": 1.999,
        "gasoleo_premium": 2.099,
        "gasolina_95": 2.019,
        "gasolina_98": 2.199,
    }

    # El JSON de salida usa el alias camelCase, no el nombre de campo Python.
    dumped = response.model_dump(by_alias=True)
    assert "preciosMaximos" in dumped
    assert "precios_maximos" not in dumped


async def test_facets_omits_fuel_without_any_priced_document():
    facets_cache.clear()
    solr_result = _solr_result(
        {
            "Precio_Gasoleo_A": {"max": 1.999},
            "Precio_Gasoleo_Premium": {"max": None},
            "Precio_Gasolina_95_E5": {"max": 2.019},
            "Precio_Gasolina_98_E5": {"max": 2.199},
        }
    )

    with patch.object(facets.solr, "query", new=AsyncMock(return_value=solr_result)):
        response = await facets.get_facets()

    assert "gasoleo_premium" not in response.precios_maximos
    assert response.precios_maximos == {
        "gasoleo_a": 1.999,
        "gasolina_95": 2.019,
        "gasolina_98": 2.199,
    }


async def test_facets_omits_fuel_missing_entirely_from_stats_fields():
    facets_cache.clear()
    solr_result = _solr_result(
        {
            "Precio_Gasoleo_A": {"max": 1.999},
            "Precio_Gasolina_95_E5": {"max": 2.019},
            "Precio_Gasolina_98_E5": {"max": 2.199},
        }
    )

    with patch.object(facets.solr, "query", new=AsyncMock(return_value=solr_result)):
        response = await facets.get_facets()

    assert "gasoleo_premium" not in response.precios_maximos
