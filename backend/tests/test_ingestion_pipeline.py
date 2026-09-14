"""Tests de los pasos discretos de ingestion.py (load_to_solr/prune_stale_in_solr),
que ahora invoca directamente el DAG `gasolineras_ingestion` (EPIC-2) en vez
de la antigua run_ingestion() monolítica. No repite los tests de
transform_station ya cubiertos en test_ingestion.py."""

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


def test_mart_row_to_solr_doc_maps_snake_case_columns():
    row = {
        "ideess": 4375,
        "id_municipio": 52,
        "id_provincia": 2,
        "id_ccaa": 7,
        "latitud": 39.211417,
        "longitud": -1.539167,
        "estacion": "Nº 10.935",
        "provincia": "ALBACETE",
        "municipio": None,
        "localidad": None,
        "direccion": None,
        "horario": None,
        "margen": None,
        "remision": None,
        "cp": None,
        "tipo_venta": None,
        "bioetanol": None,
        "ester_metilico": None,
        "precio_gasoleo_a": 1.749,
        "precio_gasoleo_b": None,
        "precio_gasoleo_premium": None,
        "precio_gasolina_95_e5": None,
        "precio_gasolina_98_e5": None,
    }

    doc = ingestion.mart_row_to_solr_doc(row)

    assert doc is not None
    assert doc["id"] == "4375"
    assert doc["IDEESS"] == 4375
    assert doc["Latitud"] == 39.211417
    assert doc["location"] == "39.211417,-1.539167"
    assert doc["Estacion"] == "Nº 10.935"
    assert doc["Provincia"] == "ALBACETE"
    assert doc["Precio_Gasoleo_A"] == 1.749
    # Los None no deben acabar como campos nulos en el documento de Solr.
    assert "Precio_Gasoleo_Premium" not in doc
    assert "Municipio" not in doc


def test_mart_row_to_solr_doc_returns_none_without_coordinates():
    assert ingestion.mart_row_to_solr_doc({"ideess": 1, "latitud": None, "longitud": -1.5}) is None


def test_mart_rows_to_solr_docs_skips_invalid_rows():
    rows = [
        {"ideess": 1, "latitud": 39.0, "longitud": -1.0},
        {"ideess": None, "latitud": 39.0, "longitud": -1.0},
    ]

    docs = ingestion.mart_rows_to_solr_docs(rows)

    assert len(docs) == 1
    assert docs[0]["id"] == "1"
