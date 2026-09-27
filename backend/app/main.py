import csv
import io
import secrets
import statistics
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from app.database import engine as configured_engine
from app.models import (
    Event,
    Judge,
    JudgeAssignment,
    JudgeInvitation,
    LocalSession,
    Prize,
    Project,
    RubricCriterion,
    Score,
    Team,
    TeamInvite,
    Track,
)


engine: Engine | None = configured_engine
app = FastAPI(title="DOGFOOD Platform")


def get_db():
    if engine is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    with Session(engine) as session:
        yield session


def actor(request: Request, db: Session = Depends(get_db)) -> LocalSession:
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    session = db.get(LocalSession, token)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return session


def require_role(*roles: str):
    def dependency(current: LocalSession = Depends(actor)) -> LocalSession:
        if current.role not in roles:
            raise HTTPException(status_code=403, detail="Role is not allowed")
        return current

    return dependency


def current_event(db: Session) -> Event:
    event = db.scalar(select(Event).order_by(Event.id).limit(1))
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def event_for_track(db: Session, track_id: str) -> Event:
    track = db.get(Track, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return track.event


def ensure_open(event: Event) -> None:
    close = event.submissions_close
    if close is not None:
        if close.tzinfo is None:
            close = close.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) >= close:
            raise HTTPException(status_code=400, detail="Submissions are closed")


def parse_optional_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def project_json(project: Project) -> dict[str, object]:
    return {
        "id": project.id,
        "team": project.team_id,
        "track": project.track_id,
        "title": project.title,
        "summary": project.summary,
        "repo_url": project.repo_url,
        "submitted_at": project.submitted_at.isoformat() if project.submitted_at else None,
        "status": project.status,
    }


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(select(1))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database is unavailable") from exc
    return {"status": "ok", "database": "ok"}


@app.get("/projects")
def gallery(q: str | None = None, track: str | None = None, db: Session = Depends(get_db)) -> list[dict[str, object]]:
    query = select(Project).where(Project.status == "submitted")
    if track:
        query = query.where(Project.track_id == track)
    projects = db.scalars(query.order_by(Project.id)).all()
    if q:
        normalized = q.casefold()
        projects = [p for p in projects if normalized in p.title.casefold() or normalized in p.summary.casefold()]
    return [project_json(project) for project in projects]


@app.post("/events", status_code=201)
def create_event(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> dict[str, str]:
    if not data.get("name"):
        raise HTTPException(status_code=422, detail="name is required")
    event_id = str(uuid4())
    dates = data.get("dates", {})
    close = parse_optional_datetime(dates.get("submissions_close")) if isinstance(dates, dict) else None
    event = Event(id=event_id, name=data["name"], dates=dates, submissions_close=close)
    db.add(event)
    for item in data.get("tracks", []):
        db.add(Track(id=item.get("id") or str(uuid4()), name=item["name"], event_id=event_id))
    for item in data.get("prizes", []):
        db.add(Prize(id=item.get("id") or str(uuid4()), event_id=event_id, value=item))
    db.commit()
    return {"id": event.id, "name": event.name}


@app.post("/teams", status_code=201)
def create_team(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant", "organizer", "admin"))) -> dict[str, str]:
    if not data.get("name"):
        raise HTTPException(status_code=422, detail="name is required")
    team = Team(id=str(uuid4()), name=data["name"], members=[current.subject_id])
    db.add(team)
    db.commit()
    return {"id": team.id, "name": team.name}


@app.post("/teams/{team_id}/invites", status_code=201)
def create_team_invite(team_id: str, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant", "organizer", "admin"))) -> dict[str, str]:
    team = db.get(Team, team_id)
    if team is None or (current.role == "participant" and current.subject_id not in team.members):
        raise HTTPException(status_code=404, detail="Team not found")
    invite = TeamInvite(token=secrets.token_urlsafe(24), team_id=team_id, created_by=current.subject_id)
    db.add(invite)
    db.commit()
    return {"invite_link": f"/team-invites/{invite.token}", "token": invite.token}


@app.post("/team-invites/{token}/accept")
def accept_team_invite(token: str, data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant"))) -> dict[str, str]:
    invite = db.get(TeamInvite, token)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    team = db.get(Team, invite.team_id)
    email = data.get("email", current.subject_id)
    if email not in team.members:
        team.members.append(email)
    invite.accepted_email = email
    db.commit()
    return {"team": team.id, "member": email}


@app.post("/projects/drafts", status_code=201)
def create_draft(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant"))) -> dict[str, object]:
    team_id, track_id = data.get("team"), data.get("track")
    if not team_id or not track_id:
        raise HTTPException(status_code=422, detail="team and track are required")
    team = db.get(Team, team_id)
    if team is None or current.subject_id not in team.members or db.get(Track, track_id) is None:
        raise HTTPException(status_code=403, detail="Participant is not a member of the team")
    ensure_open(event_for_track(db, track_id))
    project = Project(id=str(uuid4()), team_id=team_id, track_id=track_id, title=data.get("title", ""), summary=data.get("summary", ""), repo_url=data.get("repo_url"), status="draft")
    db.add(project)
    db.commit()
    return project_json(project)


@app.patch("/projects/{project_id}")
def edit_project(project_id: str, data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant"))) -> dict[str, object]:
    project = db.get(Project, project_id)
    if project is None or current.subject_id not in project.team.members:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_open(project.track.event)
    for field in ("title", "summary", "repo_url"):
        if field in data:
            setattr(project, field, data[field])
    db.commit()
    return project_json(project)


@app.post("/projects/new", status_code=201)
def submit_project(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant"))) -> dict[str, object]:
    team_id, track_id = data.get("team"), data.get("track")
    if track_id:
        ensure_open(event_for_track(db, track_id))
    else:
        ensure_open(current_event(db))
    if not data.get("title") or not data.get("summary") or not team_id or not track_id:
        raise HTTPException(status_code=422, detail="title, summary, team, and track are required")
    team, track = db.get(Team, team_id), db.get(Track, track_id)
    if team is None or track is None or current.subject_id not in team.members:
        raise HTTPException(status_code=403, detail="Participant is not a member of the team")
    project = Project(id=str(uuid4()), team_id=team_id, track_id=track_id, title=data["title"], summary=data["summary"], repo_url=data.get("repo_url"), submitted_at=datetime.now(timezone.utc), status="submitted")
    db.add(project)
    db.commit()
    return project_json(project)


@app.post("/projects/{project_id}/submit")
def submit_draft(project_id: str, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("participant"))) -> dict[str, object]:
    project = db.get(Project, project_id)
    if project is None or current.subject_id not in project.team.members:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_open(project.track.event)
    project.status, project.submitted_at = "submitted", datetime.now(timezone.utc)
    db.commit()
    return project_json(project)


@app.post("/judge-invitations", status_code=201)
def invite_judge(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> dict[str, str]:
    event = current_event(db)
    if not data.get("email"):
        raise HTTPException(status_code=422, detail="email is required")
    token = secrets.token_urlsafe(24)
    db.add(JudgeInvitation(token=token, event_id=event.id, email=data["email"], tracks=data.get("tracks", [])))
    db.commit()
    return {"invite_link": f"/judge-invitations/{token}/accept", "token": token}


@app.post("/judge-invitations/{token}/accept", status_code=201)
def accept_judge_invitation(token: str, data: dict, db: Session = Depends(get_db)) -> dict[str, str]:
    invitation = db.get(JudgeInvitation, token)
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not data.get("name"):
        raise HTTPException(status_code=422, detail="name is required")
    judge = db.scalar(select(Judge).where(Judge.email == invitation.email))
    if judge is None:
        judge = Judge(id=str(uuid4()), name=data["name"], email=invitation.email)
        db.add(judge)
    judge.tracks = [db.get(Track, track_id) for track_id in invitation.tracks]
    invitation.accepted = True
    db.commit()
    return {"id": judge.id, "name": judge.name}


@app.post("/judge-assignments", status_code=201)
def assign_judge(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> dict[str, str]:
    judge_id, project_id = data.get("judge"), data.get("project")
    if not db.get(Judge, judge_id) or not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Judge or project not found")
    assignment = db.scalar(select(JudgeAssignment).where(JudgeAssignment.judge_id == judge_id, JudgeAssignment.project_id == project_id))
    if assignment is None:
        db.add(JudgeAssignment(judge_id=judge_id, project_id=project_id))
        db.commit()
    return {"judge": judge_id, "project": project_id}


@app.put("/events/{event_id}/rubric")
def configure_rubric(event_id: str, data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> list[dict[str, object]]:
    if db.get(Event, event_id) is None:
        raise HTTPException(status_code=404, detail="Event not found")
    criteria = data.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        raise HTTPException(status_code=422, detail="criteria must be a non-empty mapping of names to weights")
    parsed: list[tuple[str, float]] = []
    for name, weight in criteria.items():
        if not name or not isinstance(weight, (float, int)) or weight <= 0:
            raise HTTPException(status_code=422, detail="criterion name and positive weight are required")
        parsed.append((name, float(weight)))
    db.query(RubricCriterion).filter_by(event_id=event_id).delete()
    result = []
    for name, weight in parsed:
        db.add(RubricCriterion(event_id=event_id, name=name, weight=weight))
        result.append({"name": name, "weight": weight})
    db.commit()
    return result


@app.get("/api/judge/scores")
def judge_scores(judge: str | None = None, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("judge"))) -> list[dict[str, object]]:
    target = judge or current.subject_id
    if target != current.subject_id:
        raise HTTPException(status_code=403, detail="Judges cannot access peer scores")
    scores = db.scalars(select(Score).where(Score.judge_id == current.subject_id).order_by(Score.project_id)).all()
    return [{"judge": s.judge_id, "project": s.project_id, "criteria": s.criteria, "comment": s.comment} for s in scores]


@app.post("/api/judge/scores", status_code=201)
def submit_score(data: dict, db: Session = Depends(get_db), current: LocalSession = Depends(require_role("judge"))) -> dict[str, object]:
    project_id = data.get("project")
    if db.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    assignment = db.scalar(select(JudgeAssignment).where(JudgeAssignment.judge_id == current.subject_id, JudgeAssignment.project_id == project_id))
    if assignment is None:
        raise HTTPException(status_code=403, detail="Project is not assigned to this judge")
    criteria = data.get("criteria")
    if not isinstance(criteria, dict) or not criteria:
        raise HTTPException(status_code=422, detail="criteria are required")
    score = db.scalar(select(Score).where(Score.judge_id == current.subject_id, Score.project_id == project_id))
    if score is None:
        score = Score(judge_id=current.subject_id, project_id=project_id, criteria=criteria, comment=data.get("comment", ""))
        db.add(score)
    else:
        score.criteria, score.comment = criteria, data.get("comment", "")
    db.commit()
    return {"judge": score.judge_id, "project": score.project_id, "criteria": score.criteria}


def criterion_weights(db: Session, event_id: str) -> dict[str, float]:
    return {item.name: item.weight for item in db.scalars(select(RubricCriterion).where(RubricCriterion.event_id == event_id))}


def weighted_score(criteria: dict[str, int], weights: dict[str, float]) -> float | None:
    applicable = [(value, weights[name]) for name, value in criteria.items() if name in weights]
    total = sum(weight for _, weight in applicable)
    return sum(value * weight for value, weight in applicable) / total if total else None


def normalize_judge_values(values: list[float]) -> list[float]:
    mean = statistics.mean(values)
    deviation = statistics.pstdev(values) if len(values) > 1 else 0.0
    if deviation == 0:
        return [3.0] * len(values)
    return [max(1.0, min(5.0, 3.0 + (value - mean) / deviation)) for value in values]


def normalized_scores(db: Session) -> list[dict[str, object]]:
    weights = criterion_weights(db, current_event(db).id)
    scores = db.scalars(select(Score).order_by(Score.project_id, Score.judge_id)).all()
    by_judge: dict[str, list[tuple[Score, float]]] = {}
    for score in scores:
        value = weighted_score(score.criteria, weights)
        if value is not None:
            by_judge.setdefault(score.judge_id, []).append((score, value))
    project_values: dict[str, list[float]] = {}
    for entries in by_judge.values():
        adjusted_values = normalize_judge_values([value for _, value in entries])
        for (score, _), adjusted in zip(entries, adjusted_values):
            project_values.setdefault(score.project_id, []).append(adjusted)
    return [{"project": project_id, "normalized_score": statistics.mean(values), "reviews": len(values)} for project_id, values in sorted(project_values.items())]


@app.get("/api/organizer/progress")
def organizer_progress(db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> list[dict[str, object]]:
    projects = db.scalars(select(Project).where(Project.status == "submitted").order_by(Project.id)).all()
    progress = []
    for project in projects:
        assignments = db.scalars(select(JudgeAssignment).where(JudgeAssignment.project_id == project.id)).all()
        reviews = db.scalars(select(Score).where(Score.project_id == project.id)).all()
        progress.append({"project": project.id, "assigned_judges": len(assignments), "completed_reviews": len(reviews), "pending_reviews": max(0, len(assignments) - len(reviews))})
    return progress


@app.get("/api/judging/normalized")
def get_normalized_scores(db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> list[dict[str, object]]:
    return normalized_scores(db)


@app.get("/api/export.csv")
def export_csv(db: Session = Depends(get_db), current: LocalSession = Depends(require_role("organizer", "admin"))) -> Response:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["project_id", "judge_id", "criteria", "comment"])
    for score in db.scalars(select(Score).order_by(Score.project_id, Score.judge_id)):
        writer.writerow([score.project_id, score.judge_id, score.criteria, score.comment])
    return Response(content=output.getvalue(), media_type="text/csv")