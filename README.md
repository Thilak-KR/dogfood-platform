# DOGFOOD Platform

A self-hostable hackathon submission and judging platform built for DOGFOOD 2026. The platform follows the event lifecycle: public gallery, participant workspace, judge review, and organizer progress and results.

**T1 and T2 are implemented and verified. T3 and T4 are not claimed.**

## Overview

The application combines a React and TypeScript frontend, a FastAPI backend, PostgreSQL, SQLAlchemy, and Alembic migrations. Docker Compose runs the services locally.

The gallery reads live submitted-project data. Participant, judge, and organizer workspaces use backend APIs; backend authorization and deadline checks remain authoritative. See the [DOGFOOD specification](docs/dogfood-spec.md) for tier requirements.

## Implemented Features

### Public Gallery

- Lists submitted projects from `GET /projects`.
- Searches title and summary through backend `q` and filters by `track`.
- Shows project title, summary, track, submission date, and the returned repository URL when present.

### Participant Workspace

- Loads the current participant session, event deadline, tracks, teams, and team projects.
- Supports team creation, invite-link creation, and invite-token acceptance.
- Supports project draft creation, draft edits, and submission through existing backend routes.
- Shows project status and deadline state; backend checks enforce ownership and deadlines.

### Judge Workspace

- Loads only projects assigned to the current judge and the event rubric.
- Supports five-point criterion scores, comments, review submission, and updates.
- Shows that judge's saved reviews. Peer scores are not requested by the frontend, and the backend rejects peer-score access.

### Organizer Workspace

- Shows submitted projects, assigned judge counts, completed and pending reviews, and normalized results.
- Resolves project IDs to titles and tracks using live gallery data.
- Provides refresh and CSV export.

### Authentication/Role Isolation

- The backend role model includes `visitor`, `participant`, `judge`, `organizer`, and `admin`.
- The frontend role selector uses seeded sessions for local/demo operation; it is not an external login system.
- Protected backend routes enforce role, ownership, and assignment checks.

### Judging/Normalization

- Organizers can configure rubric criteria and weights through the backend.
- Reviews use a weighted average of available criteria, followed by per-judge normalization and per-project aggregation.
- DOGFOOD does not prescribe the normalization formula used here. See [JUDGING.md](JUDGING.md) for the exact method.

### CSV Export

- `GET /api/export.csv` provides organizer-only score data as a downloadable CSV.
- Current columns: `project_id`, `judge_id`, `criteria`, and `comment`.

## Roles

| Role | Purpose |
| --- | --- |
| Visitor | Browse the public gallery; no visitor demo session is seeded. |
| Participant | Manage owned teams and projects. |
| Judge | Review assigned projects and access only personal scores. |
| Organizer | View progress/results, configure judging, assign judges, and export. |
| Admin | Has access to organizer-level routes where explicitly allowed. |

Seeded local/demo session identifiers:

| Session | Identifier |
| --- | --- |
| Participant | `prt_2e88` |
| Judge A | `jdg_a_91bc` |
| Judge B | `jdg_b_44de` |
| Organizer | `org_7f2a` |

The frontend selector sends the selected session cookie. These identifiers are for the seeded development/demo environment; backend authorization remains enforced.

## Architecture

```text
backend/
  app/
  migrations/
  tests/
frontend/
  src/
database/
docs/
fixtures.json
docker-compose.yml
.dogfood.toml
run.py
acceptance-report.txt
```

## Running Locally

Create the local environment file and set local database values:

```powershell
Copy-Item .env.example .env
```

Build and start the application:

```sh
docker compose up --build
```

- Frontend: [http://localhost:5173](http://localhost:5173/)
- Backend: [http://localhost:8000](http://localhost:8000/)
- Health: [http://localhost:8000/health](http://localhost:8000/health)

PostgreSQL runs through Docker Compose. On startup, the backend applies Alembic migrations and loads the checked-in fixture. Stop with `Ctrl+C` or `docker compose down`; `docker compose down -v` also removes the local database volume.

## Local Demo/Workspace Usage

Choose Participant, Judge A, Judge B, or Organizer in the frontend's **Local / Demo Role** selector. No password, email login, or hosted authentication provider is used.

The participant session subject is `checker-participant`. A clean fixture seed does not associate that subject with a team, so the workspace starts in the no-team state and offers team creation or invite acceptance.

## Testing

Run backend pytest tests:

```sh
docker compose run --rm backend pytest
```

Build the frontend:

```sh
cd frontend
npm run build
cd ..
```

Validate Compose and whitespace:

```sh
docker compose config
git diff --check
```

With services running, run the official checker:

```sh
py run.py .dogfood.toml
```

Latest verified results: **backend tests: 10 passed; frontend build: passed; DOGFOOD acceptance: claimed T1 T2, verified T1 T2.**

## Acceptance

The official T1/T2 checker verifies these seven checks, and they pass:

- Public gallery is accessible.
- A fixture project appears in the gallery response.
- The closed event refuses project submission.
- A judge can read their own scores.
- A judge cannot read peer scores.
- A participant cannot access judge scores.
- An organizer can export CSV.

See [.dogfood.toml](.dogfood.toml) for checker routes and [acceptance-report.txt](acceptance-report.txt) for the recorded result.

## Judging and Normalization

The implementation calculates a weighted average from the rubric criteria available in each review. It normalizes each judge's scores around that judge's mean using the population standard deviation, clamps normalized values to the 1-5 range, then averages them per project. A judge with no score variation contributes `3.0` for observed reviews. DOGFOOD requires weighted scoring and cross-judge normalization but does not prescribe this formula. See [JUDGING.md](JUDGING.md) for details.

## Important Demo Limitation

The checked-in fixture event deadline is **March 1, 2026**, which is in the past. A clean seeded database therefore shows the closed-event state, and the frontend does not bypass backend deadline checks. Draft creation, editing, submission, and post-deadline rejection are covered by backend tests using isolated open-deadline test data. No fixture records were altered for browser checks.

## Offline/Self-Hosted Operation

The runtime uses local Docker Compose services and requires no hosted database, hosted authentication provider, or cloud service. The first build requires container images and package dependencies to be available; after they are cached locally, the stack runs without a cloud-service dependency.

## Documentation

- [DATA-MODEL.md](DATA-MODEL.md): relational model and fixture import/export.
- [JUDGING.md](JUDGING.md): rubric, weighted score, normalization, and CSV details.
- [docs/](docs/): DOGFOOD specification and project documentation.
- [acceptance-report.txt](acceptance-report.txt): official T1/T2 checker output.

## License

The repository is licensed under the [MIT License](LICENSE).
