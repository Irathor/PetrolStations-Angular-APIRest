"""Tests de los pasos discretos de run_ingestion() (extract/load/prune),
decompuestos como parte de EPIC-1. No repite los tests de transform_station
ya cubiertos en test_ingestion.py."""

from unittest.mock import AsyncMock, patch

from app import ingestion


async def test_load_to_solr_delegates_to_solr_client():
    with patch.object(ingestion.solr, "add_documents", new=AsyncMock()) as add_documents:
        docs = [{"id": "1"}, {"id": "2"}]
        await ingestion.load_to_solr(docs)

    add_documents.assert_awaited_once_with(docs)


async def test_prune_stale_in_solr_deletes_ids_missing_from_new_set():
    with patch.object(
        ingestion.solr, "get_all_ids", new=AsyncMock(return_value={"1", "2", "3"})
    ), patch.object(ingestion.solr, "delete_by_ids", new=AsyncMock()) as delete_by_ids:
        pruned = await ingestion.prune_stale_in_solr(new_ids={"1", "2"})

    assert pruned == 1
    delete_by_ids.assert_awaited_once()
    assert set(delete_by_ids.await_args.args[0]) == {"3"}


async def test_run_ingestion_continues_when_postgres_extraction_fails():
    """La landing en Postgres es aditiva (EPIC-1): si falla, la ingesta a
    Solr debe completarse igual que antes de este cambio."""

    raw_stations = [
        {
            "IDEESS": "4375",
            "Latitud": "39,211417",
            "Longitud (WGS84)": "-1,539167",
        }
    ]

    with patch.object(ingestion, "fetch_gov_data", new=AsyncMock(return_value=raw_stations)), \
        patch.object(
            ingestion, "extract_raw_to_postgres", new=AsyncMock(side_effect=RuntimeError("sin conexión"))
        ), \
        patch.object(ingestion, "load_to_solr", new=AsyncMock()) as load_to_solr, \
        patch.object(ingestion, "prune_stale_in_solr", new=AsyncMock(return_value=0)) as prune_stale_in_solr:
        result = await ingestion.run_ingestion()

    assert result["source_total"] == 1
    assert result["indexed"] == 1
    assert result["pruned"] == 0
    load_to_solr.assert_awaited_once()
    prune_stale_in_solr.assert_awaited_once()
