import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from app import main
from app.models import (
    Base,
    Event,
    JudgeAssignment,
    LocalSession,
    Project,
    Score,
    Team,
)
from app.seed import load_fixtures


FIXTURES = Path(__file__).resolve().parents[2] / "fixtures.json"
if not FIXTURES.is_file():
    FIXTURES = Path(__file__).resolve().parents[1] / "fixtures.json"


@pytest.fixture
def test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        load_fixtures(FIXTURES, db)
    original = main.engine
    main.engine = engine
    try:
        yield engine
    finally:
        main.engine = original
        engine.dispose()


def test_official_fixture_load_preserves_records_and_is_idempotent():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = load_fixtures(FIXTURES, db)
        second = load_fixtures(FIXTURES, db)
        assert first == second == {"tracks": 8, "judges": 30, "teams": 40, "projects": 41, "scores": 126}
        assert db.scalar(select(func.count()).select_from(Project)) == 41
        assert db.scalar(select(func.count()).select_from(Score)) == 126
        assert db.get(Project, "prj_41").title == "Dry Harbour"
        duplicate = db.scalar(select(Project).where(Project.id == "prj_41"))
        assert duplicate.team_id == "tm_07"
        assert duplicate.repo_url == "https://example.org/repo/07"
        assert db.get(Event, "evt_01").name == "Sample Hack 2026"
    engine.dispose()


def test_checker_auth_gallery_deadline_and_export(test_engine):
    client = TestClient(main.app)
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}

    gallery = client.get("/projects")
    assert gallery.status_code == 200
    titles = [item["title"].casefold() for item in gallery.json()[:3]]
    assert "glass signal" in titles

    late = client.post(
        "/projects/new",
        headers={"Cookie": "session=prt_2e88"},
        json={"title": "dogfood-late-submission-probe", "summary": "probe"},
    )
    assert 400 <= late.status_code < 500

    own_scores = client.get("/api/judge/scores", headers={"Cookie": "session=jdg_a_91bc"})
    assert own_scores.status_code == 200

    peer_scores = client.get(
        "/api/judge/scores?judge=jdg_01",
        headers={"Cookie": "session=jdg_b_44de"},
    )
    assert peer_scores.status_code in (401, 403)

    reverse_peer_scores = client.get(
        "/api/judge/scores?judge=jdg_02",
        headers={"Cookie": "session=jdg_a_91bc"},
    )
    assert reverse_peer_scores.status_code in (401, 403)

    participant_scores = client.get(
        "/api/judge/scores", headers={"Cookie": "session=prt_2e88"}
    )
    assert participant_scores.status_code in (401, 403)

    csv_response = client.get("/api/export.csv", headers={"Cookie": "session=org_7f2a"})
    assert csv_response.status_code == 200
    assert "," in csv_response.text.splitlines()[0]


def test_progress_is_organizer_only_and_counts_uneven_reviews(test_engine):
    client = TestClient(main.app)
    organizer = {"Cookie": "session=org_7f2a"}
    response = client.get("/api/organizer/progress", headers=organizer)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 41
    assert len({item["completed_reviews"] for item in data}) > 1
    assert client.get("/api/organizer/progress").status_code == 401


def test_participant_workspace_returns_only_the_current_membership(test_engine):
    client = TestClient(main.app)
    participant = {"Cookie": "session=prt_2e88"}
    response = client.get("/api/participant/workspace", headers=participant)

    assert response.status_code == 200
    data = response.json()
    assert data["participant"] == {"id": "checker-participant", "role": "participant"}
    assert data["event"]["id"] == "evt_01"
    assert data["event"]["submissions_close"] == "2026-03-01T18:00:00+00:00"
    assert len(data["tracks"]) == 8
    assert data["teams"] == []

    created = client.post("/teams", headers=participant, json={"name": "Workspace team"})
    assert created.status_code == 201
    refreshed = client.get("/api/participant/workspace", headers=participant).json()
    assert [team["id"] for team in refreshed["teams"]] == [created.json()["id"]]

    assert client.get(
        "/api/participant/workspace", headers={"Cookie": "session=org_7f2a"}
    ).status_code == 403


def test_judge_workspace_contains_only_assigned_projects_and_rubric(test_engine):
    client = TestClient(main.app)
    judge = {"Cookie": "session=jdg_a_91bc"}
    response = client.get("/api/judge/workspace", headers=judge)

    assert response.status_code == 200
    data = response.json()
    assert data["projects"]
    assert all("track_name" in project for project in data["projects"])
    assert {criterion["name"] for criterion in data["criteria"]} == {
        "functionality",
        "innovation",
        "quality",
    }
    assert "scores" not in data
    assert client.get(
        "/api/judge/workspace", headers={"Cookie": "session=prt_2e88"}
    ).status_code == 403
    assert client.get(
        "/api/judge/workspace", headers={"Cookie": "session=org_7f2a"}
    ).status_code == 403


def test_event_creation_team_invites_and_rubric_configuration(test_engine):
    client = TestClient(main.app)
    organizer = {"Cookie": "session=org_7f2a"}
    participant = {"Cookie": "session=prt_2e88"}

    created = client.post("/events", headers=organizer, json={"name": "Local event", "dates": {}, "tracks": [], "prizes": []})
    assert created.status_code == 201
    team = client.post("/teams", headers=participant, json={"name": "Local team"})
    assert team.status_code == 201
    invitation = client.post(f"/teams/{team.json()['id']}/invites", headers=participant)
    assert invitation.status_code == 201
    joined = client.post(f"/team-invites/{invitation.json()['token']}/accept", headers=participant, json={"email": "new-member@example.org"})
    assert joined.status_code == 200

    rubric = client.put(
        f"/events/{created.json()['id']}/rubric",
        headers=organizer,
        json={"criteria": {"functionality": 2, "quality": 1}},
    )
    assert rubric.status_code == 200
    assert rubric.json() == [{"name": "functionality", "weight": 2}, {"name": "quality", "weight": 1}]


def test_draft_edit_and_submission_until_event_deadline(test_engine):
    client = TestClient(main.app)
    organizer = {"Cookie": "session=org_7f2a"}
    participant = {"Cookie": "session=prt_2e88"}
    close = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    event = client.post(
        "/events",
        headers=organizer,
        json={"name": "Future event", "dates": {"submissions_close": close}, "tracks": [{"id": "future-track", "name": "Track"}], "prizes": []},
    )
    assert event.status_code == 201
    team = client.post("/teams", headers=participant, json={"name": "Deadline team"})
    assert team.status_code == 201
    draft = client.post(
        "/projects/drafts",
        headers=participant,
        json={"team": team.json()["id"], "track": "future-track", "title": "Draft", "summary": "Initial"},
    )
    assert draft.status_code == 201
    project_id = draft.json()["id"]
    edited = client.patch(
        f"/projects/{project_id}",
        headers=participant,
        json={"title": "Edited after draft", "summary": "Updated"},
    )
    assert edited.status_code == 200
    submitted = client.post(f"/projects/{project_id}/submit", headers=participant)
    assert submitted.status_code == 200

    with Session(test_engine) as db:
        db.get(Event, event.json()["id"]).submissions_close = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    refused_edit = client.patch(f"/projects/{project_id}", headers=participant, json={"title": "Too late"})
    refused_submission = client.post(
        "/projects/new",
        headers=participant,
        json={"team": team.json()["id"], "track": "future-track", "title": "Too late", "summary": "probe"},
    )
    assert refused_edit.status_code == 400
    assert refused_submission.status_code == 400


def test_normalization_handles_judges_with_constant_values():
    assert main.normalize_judge_values([4.0, 4.0, 4.0]) == [3.0, 3.0, 3.0]
    assert main.normalize_judge_values([3.0]) == [3.0]


def test_judge_invitation_assignment_and_scoring(test_engine):
    client = TestClient(main.app)
    organizer = {"Cookie": "session=org_7f2a"}
    invitation = client.post(
        "/judge-invitations",
        headers=organizer,
        json={"email": "new-judge@example.org", "tracks": ["trk_04"]},
    )
    assert invitation.status_code == 201
    accepted = client.post(
        invitation.json()["invite_link"],
        json={"name": "New Judge"},
    )
    assert accepted.status_code == 201
    judge_id = accepted.json()["id"]

    assigned = client.post(
        "/judge-assignments",
        headers=organizer,
        json={"judge": judge_id, "project": "prj_01"},
    )
    assert assigned.status_code == 201
    with Session(test_engine) as db:
        db.add(LocalSession(token="new-judge-session", role="judge", subject_id=judge_id))
        db.commit()

    score = client.post(
        "/api/judge/scores",
        headers={"Cookie": "session=new-judge-session"},
        json={"project": "prj_01", "criteria": {"functionality": 4, "quality": 3}, "comment": ""},
    )
    assert score.status_code == 201
    assert score.json()["judge"] == judge_id
    assert client.get("/api/judging/normalized", headers=organizer).status_code == 200


def test_seed_fixture_values_are_not_rewritten():
    original = json.loads(FIXTURES.read_text(encoding="utf-8"))
    assert original["event"]["submissions_close"] == "2026-03-01T18:00:00Z"
    assert original["projects"][0]["id"] == "prj_01"
    assert original["projects"][0]["title"] == "Glass Signal"