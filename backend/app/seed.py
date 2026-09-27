import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import engine
from app.models import (
    Event,
    Judge,
    JudgeAssignment,
    LocalSession,
    Project,
    RubricCriterion,
    Score,
    Team,
    Track,
)


DEFAULT_SESSIONS = {
    "org_7f2a": ("organizer", "evt_01"),
    "jdg_a_91bc": ("judge", "jdg_01"),
    "jdg_b_44de": ("judge", "jdg_02"),
    "prt_2e88": ("participant", "checker-participant"),
}


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_fixtures(path: str | Path, session: Session) -> dict[str, int]:
    fixture = json.loads(Path(path).read_text(encoding="utf-8"))
    event_data = fixture["event"]
    event = session.get(Event, event_data["id"])
    if event is None:
        event = Event(
            id=event_data["id"],
            name=event_data["name"],
            submissions_close=parse_timestamp(event_data["submissions_close"]),
            dates={"submissions_close": event_data["submissions_close"]},
        )
        session.add(event)
        session.flush()

    for item in fixture["tracks"]:
        if session.get(Track, item["id"]) is None:
            session.add(Track(id=item["id"], name=item["name"], event_id=event.id))
    for item in fixture["judges"]:
        judge = session.get(Judge, item["id"])
        if judge is None:
            judge = Judge(id=item["id"], name=item["name"], email=item["email"])
            session.add(judge)
            session.flush()
        judge.tracks = [session.get(Track, track_id) for track_id in item["tracks"]]
    for item in fixture["teams"]:
        team = session.get(Team, item["id"])
        if team is None:
            team = Team(id=item["id"], name=item["name"], members=item["members"])
            session.add(team)
        else:
            team.name = item["name"]
            team.members = item["members"]
    session.flush()

    for index, item in enumerate(fixture["projects"]):
        project_id = item.get("id") or f"fixture-project-{index + 1}"
        project = session.get(Project, project_id)
        if project is None:
            project = Project(
                id=project_id,
                team_id=item["team"],
                track_id=item["track"],
                title=item["title"],
                summary=item["summary"],
                repo_url=item.get("repo_url"),
                submitted_at=parse_timestamp(item["submitted_at"]) if item.get("submitted_at") else None,
                status="submitted",
            )
            session.add(project)
    session.flush()

    for item in fixture["scores"]:
        existing = session.scalar(
            select(Score).where(
                Score.judge_id == item["judge"], Score.project_id == item["project"]
            )
        )
        if existing is None:
            session.add(
                Score(
                    judge_id=item["judge"],
                    project_id=item["project"],
                    criteria=item["criteria"],
                    comment=item.get("comment", ""),
                )
            )
    session.flush()

    for item in fixture["projects"]:
        project_id = item.get("id") or f"fixture-project-{fixture['projects'].index(item) + 1}"
        project = session.get(Project, project_id)
        for judge in session.scalars(select(Judge).join(Judge.tracks).where(Track.id == project.track_id)):
            assignment = session.scalar(
                select(JudgeAssignment).where(
                    JudgeAssignment.judge_id == judge.id,
                    JudgeAssignment.project_id == project.id,
                )
            )
            if assignment is None:
                session.add(JudgeAssignment(judge_id=judge.id, project_id=project.id))

    criteria_names = sorted({name for item in fixture["scores"] for name in item["criteria"]})
    existing_criteria = set(
        session.scalars(select(RubricCriterion.name).where(RubricCriterion.event_id == event.id))
    )
    for name in criteria_names:
        if name not in existing_criteria:
            session.add(RubricCriterion(event_id=event.id, name=name, weight=1.0))

    existing_tokens = set(session.scalars(select(LocalSession.token)))
    for token, (role, subject_id) in DEFAULT_SESSIONS.items():
        if token not in existing_tokens:
            session.add(LocalSession(token=token, role=role, subject_id=subject_id))
    session.commit()

    return {
        "tracks": len(fixture["tracks"]),
        "judges": len(fixture["judges"]),
        "teams": len(fixture["teams"]),
        "projects": len(fixture["projects"]),
        "scores": len(fixture["scores"]),
    }


def main() -> None:
    if engine is None:
        raise RuntimeError("Database is not configured")
    path = os.getenv("DOGFOOD_FIXTURES", "/app/fixtures.json")
    with Session(engine) as session:
        counts = load_fixtures(path, session)
    print(f"Loaded DOGFOOD fixture data: {counts}")
    print("Local checker sessions: " + ", ".join(DEFAULT_SESSIONS))


if __name__ == "__main__":
    main()