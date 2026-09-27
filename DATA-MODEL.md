# Data Model

This is the implementation's relational representation of the fixture and T1/T2 concepts. The DOGFOOD specification does not require these table names or this schema.

| Table | Purpose |
| --- | --- |
| `events` | Event identity, name, configurable dates, including `submissions_close` |
| `tracks` | Tracks belonging to an event |
| `prizes` | Event prizes stored as supplied JSON values |
| `teams` | Team identity and name |
| `team_member_records` | Email members associated with a team |
| `team_invites` | Local invite-link tokens and accepted email |
| `projects` | Draft/submitted project records; IDs are strings |
| `judges` | Judge identity, name, and email |
| `judge_tracks` | Fixture track associations for judges |
| `judge_invitations` | Local invitation token, event, email, and track values |
| `judge_assignments` | Judge-to-project assignment; unique per pair |
| `rubric_criteria` | Organizer-configured criterion names and weights per event |
| `scores` | One score per judge/project pair; `criteria` preserves fixture values as JSON and comment may be empty |
| `local_sessions` | Deterministic local session tokens, subject IDs, and the named role |

Fixture project records `prj_01` through `prj_41` are preserved, including the second submission for team `tm_07`; no team uniqueness rule is applied to projects. Fixture timestamps are parsed from ISO 8601 UTC strings and stored as timezone-aware datetimes.

## Import and export

`fixtures.json` is loaded by `app.seed` after Alembic migrations. Loading is idempotent for the shipped fixture IDs. It does not synthesize fixture records. CSV export is organizer-only and currently emits `project_id`, `judge_id`, `criteria`, and `comment` columns.