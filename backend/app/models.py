from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.ext.associationproxy import association_proxy


class Base(DeclarativeBase):
    pass


JSON_VALUE = JSON().with_variant(JSONB, "postgresql")


judge_tracks = Table(
    "judge_tracks",
    Base.metadata,
    Column("judge_id", String, ForeignKey("judges.id", ondelete="CASCADE"), primary_key=True),
    Column("track_id", String, ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True),
)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    submissions_close: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dates: Mapped[dict[str, str]] = mapped_column(JSON_VALUE, nullable=False, default=dict)

    tracks: Mapped[list[Track]] = relationship(back_populates="event", cascade="all, delete-orphan")
    prizes: Mapped[list[Prize]] = relationship(back_populates="event", cascade="all, delete-orphan")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)

    event: Mapped[Event] = relationship(back_populates="tracks")
    judges: Mapped[list[Judge]] = relationship(secondary=judge_tracks, back_populates="tracks")
    projects: Mapped[list[Project]] = relationship(back_populates="track")


class Prize(Base):
    __tablename__ = "prizes"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    value: Mapped[object] = mapped_column(JSON_VALUE, nullable=False)

    event: Mapped[Event] = relationship(back_populates="prizes")


class Judge(Base):
    __tablename__ = "judges"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    tracks: Mapped[list[Track]] = relationship(secondary=judge_tracks, back_populates="judges")
    scores: Mapped[list[Score]] = relationship(back_populates="judge")
    assignments: Mapped[list[JudgeAssignment]] = relationship(back_populates="judge")


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    member_rows: Mapped[list[TeamMember]] = relationship(back_populates="team", cascade="all, delete-orphan")
    members = association_proxy("member_rows", "email", creator=lambda email: TeamMember(email=email))

    projects: Mapped[list[Project]] = relationship(back_populates="team")
    invites: Mapped[list[TeamInvite]] = relationship(back_populates="team", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False)
    track_id: Mapped[str] = mapped_column(ForeignKey("tracks.id", ondelete="RESTRICT"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    summary: Mapped[str] = mapped_column(String, nullable=False)
    repo_url: Mapped[str | None] = mapped_column(String)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String, nullable=False, default="draft")

    __table_args__ = (
        CheckConstraint("status IN ('draft', 'submitted')", name="ck_projects_status"),
    )

    team: Mapped[Team] = relationship(back_populates="projects")
    track: Mapped[Track] = relationship(back_populates="projects")
    scores: Mapped[list[Score]] = relationship(back_populates="project", cascade="all, delete-orphan")
    assignments: Mapped[list[JudgeAssignment]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Score(Base):
    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    judge_id: Mapped[str] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    criteria: Mapped[dict[str, int]] = mapped_column(JSON_VALUE, nullable=False)
    comment: Mapped[str] = mapped_column(String, nullable=False, default="")

    __table_args__ = (
        UniqueConstraint("judge_id", "project_id", name="uq_scores_judge_project"),
    )

    judge: Mapped[Judge] = relationship(back_populates="scores")
    project: Mapped[Project] = relationship(back_populates="scores")


class RubricCriterion(Base):
    __tablename__ = "rubric_criteria"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)

    __table_args__ = (
        UniqueConstraint("event_id", "name", name="uq_rubric_criteria_event_name"),
        CheckConstraint("weight > 0", name="ck_rubric_criteria_positive_weight"),
    )


class JudgeAssignment(Base):
    __tablename__ = "judge_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    judge_id: Mapped[str] = mapped_column(ForeignKey("judges.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        UniqueConstraint("judge_id", "project_id", name="uq_judge_assignments_judge_project"),
    )

    judge: Mapped[Judge] = relationship(back_populates="assignments")
    project: Mapped[Project] = relationship(back_populates="assignments")


class LocalSession(Base):
    __tablename__ = "local_sessions"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    subject_id: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "role IN ('visitor', 'participant', 'judge', 'organizer', 'admin')",
            name="ck_local_sessions_role",
        ),
    )


class TeamInvite(Base):
    __tablename__ = "team_invites"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), nullable=False)
    created_by: Mapped[str] = mapped_column(String, nullable=False)
    accepted_email: Mapped[str | None] = mapped_column(String)

    team: Mapped[Team] = relationship(back_populates="invites")


class TeamMember(Base):
    __tablename__ = "team_member_records"

    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[str] = mapped_column(String, primary_key=True)

    team: Mapped[Team] = relationship(back_populates="member_rows")


class JudgeInvitation(Base):
    __tablename__ = "judge_invitations"

    token: Mapped[str] = mapped_column(String, primary_key=True)
    event_id: Mapped[str] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False)
    tracks: Mapped[list[str]] = mapped_column(JSON_VALUE, nullable=False, default=list)
    accepted: Mapped[bool] = mapped_column(nullable=False, default=False)