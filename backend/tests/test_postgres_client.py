from unittest.mock import patch

from app.postgres_client import extract_raw_to_postgres


class _FakeCursor:
    def __init__(self):
        self.executed: list[tuple] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def execute(self, sql, *params):
        self.executed.append(("execute", sql, params))

    async def executemany(self, sql, rows):
        self.executed.append(("executemany", sql, rows))


class _FakeConnection:
    def __init__(self):
        self.cursor_obj = _FakeCursor()
        self.committed = False

    def cursor(self):
        return self.cursor_obj

    async def commit(self):
        self.committed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


async def test_extract_raw_to_postgres_inserts_one_row_per_station():
    fake_conn = _FakeConnection()

    async def fake_connect(conninfo):
        return fake_conn

    raw_stations = [{"IDEESS": "1"}, {"IDEESS": "2"}, {"IDEESS": "3"}]

    with patch("app.postgres_client.psycopg.AsyncConnection.connect", side_effect=fake_connect):
        run_id = await extract_raw_to_postgres(raw_stations, run_id="fixed-run-id")

    assert run_id == "fixed-run-id"
    assert fake_conn.committed is True

    executemany_calls = [c for c in fake_conn.cursor_obj.executed if c[0] == "executemany"]
    assert len(executemany_calls) == 1
    inserted_rows = executemany_calls[0][2]
    assert len(inserted_rows) == 3
    assert [row[0] for row in inserted_rows] == ["fixed-run-id"] * 3
    assert [row[2] for row in inserted_rows] == ["1", "2", "3"]


async def test_extract_raw_to_postgres_generates_run_id_when_not_given():
    fake_conn = _FakeConnection()

    async def fake_connect(conninfo):
        return fake_conn

    with patch("app.postgres_client.psycopg.AsyncConnection.connect", side_effect=fake_connect):
        run_id = await extract_raw_to_postgres([{"IDEESS": "1"}])

    assert run_id  # no vacío
    assert isinstance(run_id, str)


async def test_extract_raw_to_postgres_creates_table_before_inserting():
    fake_conn = _FakeConnection()

    async def fake_connect(conninfo):
        return fake_conn

    with patch("app.postgres_client.psycopg.AsyncConnection.connect", side_effect=fake_connect):
        await extract_raw_to_postgres([{"IDEESS": "1"}], run_id="run-1")

    executed_sql = [c[1] for c in fake_conn.cursor_obj.executed if c[0] == "execute"]
    assert any("CREATE TABLE IF NOT EXISTS gasolineras.raw_stations" in sql for sql in executed_sql)
