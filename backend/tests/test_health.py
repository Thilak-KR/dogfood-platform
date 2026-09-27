from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app import main


def test_health_reports_database_ready(monkeypatch) -> None:
    test_engine = create_engine("sqlite://")
    monkeypatch.setattr(main, "engine", test_engine)

    response = TestClient(main.app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    test_engine.dispose()


def test_health_reports_missing_database_configuration(monkeypatch) -> None:
    monkeypatch.setattr(main, "engine", None)

    response = TestClient(main.app).get("/health")

    assert response.status_code == 503