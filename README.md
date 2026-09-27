# DOGFOOD Platform

Local DOGFOOD submission and judging platform foundation. The stack contains a React + TypeScript frontend, a FastAPI backend, and PostgreSQL. T1/T2 backend workflows and the shared fixture data are included; T3/T4 are not implemented. The React frontend remains the Phase 1 placeholder; T1/T2 workflows are currently exposed through the backend rather than complete visual workflows.

## Start locally

In PowerShell, copy `.env.example` to `.env` and replace the placeholder database password with a local value:

```powershell
Copy-Item .env.example .env
```

Then build and start the services:

```powershell
docker compose up --build
```

Open the frontend at <http://localhost:5173>. The backend health endpoint is <http://localhost:8000/health>; a healthy response is `{"status":"ok","database":"ok"}`. The backend applies Alembic migrations and loads the checked-in shared fixture before it starts serving requests. PostgreSQL remains internal to the Compose network.

Stop the stack with `Ctrl+C`, or run `docker compose down`. Use `docker compose down -v` only when you also intend to delete the local PostgreSQL data volume.

## Tests

Run backend tests in the built container:

```powershell
docker compose run --rm backend pytest
```

The official checker is available as `run.py`; run it after starting the stack:

```powershell
python run.py .dogfood.toml > acceptance-report.txt
```

The checker config uses `http://localhost:8000` and its example route/auth values. Local deterministic checker sessions are seeded for `org_7f2a`, `jdg_a_91bc`, `jdg_b_44de`, and `prt_2e88`. This session setup is for local/self-hosted operation, not external authentication.

## Implemented T1/T2 routes

- `GET /projects`: public submitted-project gallery; supports `q` search and `track` filtering.
- `POST /projects/new`: participant submission; the backend refuses submissions after the event's `submissions_close`.
- `POST /projects/drafts`, `PATCH /projects/{project_id}`, and `POST /projects/{project_id}/submit`: draft, edit, and submit.
- `POST /events`: event creation with dates, tracks, and prizes.
- `POST /teams`, `POST /teams/{team_id}/invites`, and `POST /team-invites/{token}/accept`: team and invite-link workflow.
- `POST /judge-invitations`, `POST /judge-invitations/{token}/accept`, and `POST /judge-assignments`: judge invitation and assignment.
- `PUT /events/{event_id}/rubric`: configure criteria weights using a criterion-name-to-weight mapping.
- `GET` and `POST /api/judge/scores`: read only the current judge's scores and submit a score for an assigned project.
- `GET /api/organizer/progress`: per-project assigned, completed, and pending review counts.
- `GET /api/judging/normalized`: normalized project scores for organizers.
- `GET /api/export.csv`: organizer-only score export.

The checker does not require API route names to match its example; `.dogfood.toml` points it to this implementation's checker routes.

## Design choices and limitations

Database table names are implementation choices, not DOGFOOD requirements. See [DATA-MODEL.md](DATA-MODEL.md) and [JUDGING.md](JUDGING.md) for the schema, weighted score, normalization method, and CSV columns. The fixture does not define rubric weights; the loader initializes observed criteria with equal weight `1.0`. The chosen normalization uses per-judge population z-scores mapped around `3.0`, clamps to `1` through `5`, and assigns `3.0` when a judge has no score variation or only one score. The specification does not prescribe that formula.

## Local and offline operation

All runtime services are local containers; the application does not call cloud databases, hosted authentication, or other external services. A first build needs the base images and package dependencies available to Docker. Once those are cached locally, the containers run without a cloud service dependency.