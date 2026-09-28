import { useEffect, useLayoutEffect, useState } from "react";

type Project = {
  id: string;
  team: string;
  track: string;
  title: string;
  summary: string;
  repo_url: string | null;
  submitted_at: string | null;
  status: string;
};

type Track = {
  id: string;
  name: string;
};

type DemoRole = "participant" | "judge-a" | "judge-b" | "organizer";

const DEMO_SESSIONS: Record<DemoRole, { label: string; token: string }> = {
  participant: { label: "Participant", token: "prt_2e88" },
  "judge-a": { label: "Judge A", token: "jdg_a_91bc" },
  "judge-b": { label: "Judge B", token: "jdg_b_44de" },
  organizer: { label: "Organizer", token: "org_7f2a" },
};

type ParticipantTeam = {
  id: string;
  name: string;
  members: string[];
  projects: Project[];
};

type ParticipantWorkspaceData = {
  participant: { id: string; role: "participant" };
  event: {
    id: string;
    name: string;
    submissions_close: string | null;
    dates: Record<string, string>;
  };
  tracks: Track[];
  teams: ParticipantTeam[];
};

type JudgeProject = Project & { track_name: string };

type RubricCriterion = {
  name: string;
  weight: number;
};

type JudgeWorkspaceData = {
  projects: JudgeProject[];
  criteria: RubricCriterion[];
};

type JudgeScore = {
  judge: string;
  project: string;
  criteria: Record<string, number>;
  comment: string;
};

function formatSubmittedDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

type ProjectProgress = {
  project: string;
  assigned_judges: number;
  completed_reviews: number;
  pending_reviews: number;
};

type NormalizedResult = {
  project: string;
  normalized_score: number;
  reviews: number;
};

type ProjectSummary = Pick<Project, "id" | "title" | "track">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseProgress(payload: unknown): ProjectProgress[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid organizer response.");
  }

  return payload.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.project !== "string" ||
      !isCount(item.assigned_judges) ||
      !isCount(item.completed_reviews) ||
      !isCount(item.pending_reviews)
    ) {
      throw new Error("Invalid organizer response.");
    }

    return {
      project: item.project,
      assigned_judges: item.assigned_judges,
      completed_reviews: item.completed_reviews,
      pending_reviews: item.pending_reviews,
    };
  });
}

function parseNormalizedResults(payload: unknown): NormalizedResult[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid organizer response.");
  }

  return payload.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.project !== "string" ||
      typeof item.normalized_score !== "number" ||
      !Number.isFinite(item.normalized_score) ||
      !isCount(item.reviews)
    ) {
      throw new Error("Invalid organizer response.");
    }

    return {
      project: item.project,
      normalized_score: item.normalized_score,
      reviews: item.reviews,
    };
  });
}

function parseProjectSummaries(payload: unknown): ProjectSummary[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid organizer response.");
  }

  return payload.flatMap((item): ProjectSummary[] =>
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.track === "string"
      ? [{ id: item.id, title: item.title, track: item.track }]
      : [],
  );
}

async function fetchResponse(
  path: string,
  init: RequestInit = {},
  accessMessage = "Organizer access required.",
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(accessMessage);
    }
    let detail = "";
    try {
      const payload: unknown = await response.clone().json();
      if (isRecord(payload) && typeof payload.detail === "string") {
        detail = payload.detail
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .slice(0, 240);
      }
    } catch {
      detail = "";
    }
    if (response.status === 403 && (!detail || detail === "Role is not allowed")) {
      throw new Error(accessMessage);
    }
    throw new Error(detail || "API request failed.");
  }

  return response;
}

async function fetchJson(
  path: string,
  signal: AbortSignal,
  accessMessage = "Organizer access required.",
): Promise<unknown> {
  const response = await fetchResponse(path, { signal }, accessMessage);
  return (await response.json()) as unknown;
}

async function sendJson(
  path: string,
  method: string,
  body: unknown,
  accessMessage: string,
): Promise<unknown> {
  const response = await fetchResponse(
    path,
    { method, body: JSON.stringify(body) },
    accessMessage,
  );
  return (await response.json()) as unknown;
}

function parseProject(value: unknown): Project | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.team !== "string" ||
    typeof value.track !== "string" ||
    typeof value.title !== "string" ||
    typeof value.summary !== "string" ||
    !(typeof value.repo_url === "string" || value.repo_url === null) ||
    !(typeof value.submitted_at === "string" || value.submitted_at === null) ||
    typeof value.status !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    team: value.team,
    track: value.track,
    title: value.title,
    summary: value.summary,
    repo_url: value.repo_url,
    submitted_at: value.submitted_at,
    status: value.status,
  };
}

function parseParticipantWorkspace(payload: unknown): ParticipantWorkspaceData {
  if (
    !isRecord(payload) ||
    !isRecord(payload.participant) ||
    typeof payload.participant.id !== "string" ||
    payload.participant.role !== "participant" ||
    !isRecord(payload.event) ||
    typeof payload.event.id !== "string" ||
    typeof payload.event.name !== "string" ||
    !(typeof payload.event.submissions_close === "string" || payload.event.submissions_close === null) ||
    !isRecord(payload.event.dates) ||
    !Array.isArray(payload.tracks) ||
    !Array.isArray(payload.teams)
  ) {
    throw new Error("Invalid participant workspace response.");
  }

  const tracks = payload.tracks.flatMap((value): Track[] =>
    isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
      ? [{ id: value.id, name: value.name }]
      : [],
  );
  const teams = payload.teams.map((value): ParticipantTeam => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      !Array.isArray(value.members) ||
      !value.members.every((member) => typeof member === "string") ||
      !Array.isArray(value.projects)
    ) {
      throw new Error("Invalid participant workspace response.");
    }
    const projects = value.projects.map(parseProject);
    if (projects.some((project) => project === null)) {
      throw new Error("Invalid participant workspace response.");
    }
    return {
      id: value.id,
      name: value.name,
      members: value.members,
      projects: projects as Project[],
    };
  });

  const dates = Object.fromEntries(
    Object.entries(payload.event.dates).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );

  return {
    participant: { id: payload.participant.id, role: "participant" },
    event: {
      id: payload.event.id,
      name: payload.event.name,
      submissions_close: payload.event.submissions_close,
      dates,
    },
    tracks,
    teams,
  };
}

function participantActionMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "That action could not be completed. Please try again.";
  }
  if (error.message === "Participant access required.") {
    return error.message;
  }
  if (error.message === "API request failed.") {
    return "That action could not be completed. Check the details and try again.";
  }
  return error.message;
}

function ParticipantWorkspace() {
  const [workspace, setWorkspace] = useState<ParticipantWorkspaceData | null>(null);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedTrack, setSelectedTrack] = useState("");
  const [teamName, setTeamName] = useState("");
  const [inviteTeam, setInviteTeam] = useState("");
  const [inviteToken, setInviteToken] = useState(
    () => new URLSearchParams(window.location.search).get("invite") ?? "",
  );
  const [acceptedEmail, setAcceptedEmail] = useState("");
  const [inviteResult, setInviteResult] = useState("");
  const [projectDraft, setProjectDraft] = useState({ title: "", summary: "", repo_url: "" });
  const [editingProjectId, setEditingProjectId] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetchJson(
      "/api/participant/workspace",
      controller.signal,
      "Participant access required.",
    )
      .then((payload) => {
        const data = parseParticipantWorkspace(payload);
        setWorkspace(data);
        setSelectedTeam((current) =>
          data.teams.some((team) => team.id === current)
            ? current
            : data.teams[0]?.id ?? "",
        );
        setInviteTeam((current) =>
          data.teams.some((team) => team.id === current)
            ? current
            : data.teams[0]?.id ?? "",
        );
        setSelectedTrack((current) =>
          data.tracks.some((track) => track.id === current)
            ? current
            : data.tracks[0]?.id ?? "",
        );
        setIsLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }
        setError(
          requestError instanceof Error &&
            (requestError.message === "Participant access required." ||
              requestError.message === "Invalid participant workspace response.")
            ? requestError.message
            : "Participant workspace could not be loaded. Please try again.",
        );
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [refreshCount]);

  const selectedTeamData = workspace?.teams.find((team) => team.id === selectedTeam);
  const deadline = workspace?.event.submissions_close
    ? new Date(workspace.event.submissions_close)
    : null;
  const isDeadlinePassed = deadline !== null && !Number.isNaN(deadline.getTime()) && deadline.getTime() <= Date.now();

  async function createTeam() {
    setIsSaving(true);
    setMessage("");
    setError(null);
    try {
      const payload = await sendJson(
        "/teams",
        "POST",
        { name: teamName.trim() },
        "Participant access required.",
      );
      if (!isRecord(payload) || typeof payload.id !== "string") {
        throw new Error("The team response was invalid.");
      }
      setTeamName("");
      setSelectedTeam(payload.id);
      setInviteTeam(payload.id);
      setMessage("Team created.");
      setRefreshCount((count) => count + 1);
    } catch (actionError: unknown) {
      setError(participantActionMessage(actionError));
    } finally {
      setIsSaving(false);
    }
  }

  async function createInvite() {
    if (!inviteTeam) return;
    setIsSaving(true);
    setMessage("");
    setError(null);
    try {
      const response = await sendJson(
        `/teams/${encodeURIComponent(inviteTeam)}/invites`,
        "POST",
        {},
        "Participant access required.",
      );
      if (!isRecord(response) || typeof response.token !== "string" || typeof response.invite_link !== "string") {
        throw new Error("The invitation response was invalid.");
      }
      setInviteResult(
        `${window.location.origin}/?invite=${encodeURIComponent(response.token)}`,
      );
      setMessage("Invite created. Share this link with your teammate.");
    } catch (actionError: unknown) {
      setError(participantActionMessage(actionError));
    } finally {
      setIsSaving(false);
    }
  }

  async function acceptInvite() {
    const token = inviteToken.trim();
    if (!token) return;
    setIsSaving(true);
    setMessage("");
    setError(null);
    try {
      const result = await sendJson(
        `/team-invites/${encodeURIComponent(token)}/accept`,
        "POST",
        acceptedEmail.trim() ? { email: acceptedEmail.trim() } : {},
        "Participant access required.",
      );
      if (!isRecord(result) || typeof result.team !== "string") {
        throw new Error("The invitation response was invalid.");
      }
      setSelectedTeam(result.team);
      setInviteTeam(result.team);
      setInviteToken("");
      window.history.replaceState({}, "", window.location.pathname);
      setMessage("Invite accepted. Your team is ready.");
      setRefreshCount((count) => count + 1);
    } catch (actionError: unknown) {
      setError(participantActionMessage(actionError));
    } finally {
      setIsSaving(false);
    }
  }

  function editProject(project: Project) {
    setEditingProjectId(project.id);
    setSelectedTrack(project.track);
    setProjectDraft({
      title: project.title,
      summary: project.summary,
      repo_url: project.repo_url ?? "",
    });
    setMessage("");
    setError(null);
  }

  async function saveProject(submitAfterSave: boolean) {
    if (!selectedTeam || !selectedTrack) return;
    setIsSaving(true);
    setMessage("");
    setError(null);
    try {
      let projectId = editingProjectId;
      if (editingProjectId) {
        await sendJson(
          `/projects/${encodeURIComponent(editingProjectId)}`,
          "PATCH",
          {
            title: projectDraft.title,
            summary: projectDraft.summary,
            repo_url: projectDraft.repo_url || null,
          },
          "Participant access required.",
        );
      } else {
        const created = await sendJson(
          "/projects/drafts",
          "POST",
          {
            team: selectedTeam,
            track: selectedTrack,
            title: projectDraft.title,
            summary: projectDraft.summary,
            repo_url: projectDraft.repo_url || null,
          },
          "Participant access required.",
        );
        if (!isRecord(created) || typeof created.id !== "string") {
          throw new Error("The project response was invalid.");
        }
        projectId = created.id;
      }

      if (submitAfterSave) {
        await sendJson(
          `/projects/${encodeURIComponent(projectId)}/submit`,
          "POST",
          {},
          "Participant access required.",
        );
        setMessage("Project submitted.");
      } else {
        setMessage(editingProjectId ? "Draft updated." : "Draft created.");
      }
      setProjectDraft({ title: "", summary: "", repo_url: "" });
      setEditingProjectId("");
      setRefreshCount((count) => count + 1);
    } catch (actionError: unknown) {
      setError(participantActionMessage(actionError));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="content participant-content">
      <section className="intro" aria-labelledby="participant-title">
        <p className="eyebrow">PARTICIPANT AREA</p>
        <h1 id="participant-title">Participant Workspace</h1>
        <p className="intro-copy">
          {workspace ? `Welcome, ${workspace.participant.id}.` : "Manage your team and project submission."}
        </p>
      </section>

      <div className="workspace-actions">
        <span className="session-badge">Participant session active</span>
        <button type="button" className="secondary-action" onClick={() => setRefreshCount((count) => count + 1)} disabled={isLoading || isSaving}>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p className="notice" role="status">Loading participant workspace...</p>
      ) : error && !workspace ? (
        <div className="notice error-notice" role="alert">
          <h2>{error}</h2>
          <button type="button" onClick={() => setRefreshCount((count) => count + 1)}>Try again</button>
        </div>
      ) : workspace ? (
        <>
          {isDeadlinePassed ? (
            <div className="deadline-banner" role="status">
              <strong>Submissions are closed</strong>
              <span>
                The deadline was {deadline ? formatSubmittedDate(deadline.toISOString()) : "reached"}.
                Existing project data remains available below.
              </span>
            </div>
          ) : (
            <div className="deadline-banner deadline-open" role="status">
              <strong>{workspace.event.name}</strong>
              <span>
                {deadline
                  ? `Submissions close ${formatSubmittedDate(deadline.toISOString())}.`
                  : "No submission deadline is set."}
              </span>
            </div>
          )}

          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {message && <p className="form-message" role="status">{message}</p>}
          {inviteResult && (
            <div className="invite-result">
              <strong>Team invite link</strong>
              <a href={inviteResult}>{inviteResult}</a>
              <button type="button" className="text-action" onClick={() => navigator.clipboard.writeText(inviteResult)}>
                Copy link
              </button>
            </div>
          )}

          <section className="workspace-section" aria-labelledby="team-title">
            <div className="organizer-section-heading">
              <div><p className="eyebrow">YOUR TEAM</p><h2 id="team-title">Team management</h2></div>
            </div>
            <div className="participant-grid">
              <article className="workspace-card">
                <h3>Your teams</h3>
                {workspace.teams.length === 0 ? (
                  <p className="workspace-description">You are not a member of a team yet. Create one or accept an invite.</p>
                ) : (
                  <div className="team-list">
                    {workspace.teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        className={team.id === selectedTeam ? "team-choice selected" : "team-choice"}
                        onClick={() => setSelectedTeam(team.id)}
                      >
                        <strong>{team.name}</strong>
                        <span>{team.members.length} {team.members.length === 1 ? "member" : "members"}</span>
                      </button>
                    ))}
                  </div>
                )}
                <label className="form-field">
                  <span>New team name</span>
                  <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Team name" />
                </label>
                <button type="button" className="primary-action" disabled={!teamName.trim() || isSaving} onClick={createTeam}>
                  Create team
                </button>
              </article>

              <article className="workspace-card">
                <h3>Invite teammates</h3>
                {workspace.teams.length > 0 ? (
                  <>
                    <label className="form-field">
                      <span>Team</span>
                      <select value={inviteTeam} onChange={(event) => setInviteTeam(event.target.value)}>
                        {workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                      </select>
                    </label>
                    <button type="button" className="secondary-action" disabled={!inviteTeam || isSaving} onClick={createInvite}>
                      Create invite link
                    </button>
                  </>
                ) : <p className="workspace-description">Create a team before inviting teammates.</p>}
                <div className="form-divider" />
                <label className="form-field">
                  <span>Accept an invite token</span>
                  <input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Paste invite token" />
                </label>
                <label className="form-field">
                  <span>Email (optional)</span>
                  <input type="email" value={acceptedEmail} onChange={(event) => setAcceptedEmail(event.target.value)} placeholder="Your teammate email" />
                </label>
                <button type="button" className="secondary-action" disabled={!inviteToken.trim() || isSaving} onClick={acceptInvite}>
                  Accept invite
                </button>
              </article>
            </div>
          </section>

          <section className="workspace-section" aria-labelledby="submission-title">
            <div className="organizer-section-heading">
              <div><p className="eyebrow">PROJECT</p><h2 id="submission-title">Project submission</h2></div>
            </div>
            {selectedTeamData?.projects.length ? (
              <div className="team-project-list">
                {selectedTeamData.projects.map((project) => (
                  <article className="team-project-row" key={project.id}>
                    <div>
                      <strong>{project.title || "Untitled draft"}</strong>
                      <span>{project.status} · {project.track}</span>
                    </div>
                    {project.status === "draft" && (
                      <button type="button" className="text-action" onClick={() => editProject(project)}>
                        Edit draft
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="notice workspace-empty">
                {selectedTeamData ? "This team has no projects yet." : "Select or create a team to start a project."}
              </p>
            )}

            {selectedTeamData && (
              <article className="workspace-card project-editor">
                <h3>{editingProjectId ? "Edit project draft" : "Create project draft"}</h3>
                <label className="form-field">
                  <span>Team</span>
                  <select value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
                    {workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Track</span>
                  <select value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value)}>
                    {workspace.tracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>Project title</span>
                  <input value={projectDraft.title} onChange={(event) => setProjectDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="Project title" />
                </label>
                <label className="form-field">
                  <span>Summary</span>
                  <textarea value={projectDraft.summary} onChange={(event) => setProjectDraft((draft) => ({ ...draft, summary: event.target.value }))} placeholder="What does your project do?" rows={4} />
                </label>
                <label className="form-field">
                  <span>Repository URL</span>
                  <input type="url" value={projectDraft.repo_url} onChange={(event) => setProjectDraft((draft) => ({ ...draft, repo_url: event.target.value }))} placeholder="https://" />
                </label>
                <div className="project-form-actions">
                  <button type="button" className="secondary-action" disabled={isDeadlinePassed || isSaving || !selectedTrack} onClick={() => saveProject(false)}>
                    {editingProjectId ? "Save draft" : "Create draft"}
                  </button>
                  <button type="button" className="primary-action" disabled={isDeadlinePassed || isSaving || !selectedTrack || !projectDraft.title.trim() || !projectDraft.summary.trim()} onClick={() => saveProject(true)}>
                    Save and submit
                  </button>
                  {editingProjectId && (
                    <button type="button" className="text-action" onClick={() => { setEditingProjectId(""); setProjectDraft({ title: "", summary: "", repo_url: "" }); }}>
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

function parseJudgeWorkspace(payload: unknown): JudgeWorkspaceData {
  if (!isRecord(payload) || !Array.isArray(payload.projects) || !Array.isArray(payload.criteria)) {
    throw new Error("Invalid judge workspace response.");
  }
  const projects = payload.projects.map((value): JudgeProject => {
    const project = parseProject(value);
    if (!project || !isRecord(value) || typeof value.track_name !== "string") {
      throw new Error("Invalid judge workspace response.");
    }
    return { ...project, track_name: value.track_name };
  });
  const criteria = payload.criteria.map((value): RubricCriterion => {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      typeof value.weight !== "number" ||
      !Number.isFinite(value.weight) ||
      value.weight <= 0
    ) {
      throw new Error("Invalid judge workspace response.");
    }
    return { name: value.name, weight: value.weight };
  });
  return { projects, criteria };
}

function parseJudgeScores(payload: unknown): JudgeScore[] {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid judge scores response.");
  }
  return payload.map((value): JudgeScore => {
    if (
      !isRecord(value) ||
      typeof value.judge !== "string" ||
      typeof value.project !== "string" ||
      !isRecord(value.criteria) ||
      typeof value.comment !== "string" ||
      !Object.values(value.criteria).every((score) => typeof score === "number")
    ) {
      throw new Error("Invalid judge scores response.");
    }
    return {
      judge: value.judge,
      project: value.project,
      criteria: value.criteria as Record<string, number>,
      comment: value.comment,
    };
  });
}

function JudgeWorkspace() {
  const [workspace, setWorkspace] = useState<JudgeWorkspaceData | null>(null);
  const [scores, setScores] = useState<JudgeScore[]>([]);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, Record<string, number>>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [refreshCount, setRefreshCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    Promise.all([
      fetchJson("/api/judge/workspace", controller.signal, "Judge access required."),
      fetchJson("/api/judge/scores", controller.signal, "Judge access required."),
    ])
      .then(([workspacePayload, scoresPayload]) => {
        const data = parseJudgeWorkspace(workspacePayload);
        const ownScores = parseJudgeScores(scoresPayload);
        setWorkspace(data);
        setScores(ownScores);
        setScoreDrafts({});
        setCommentDrafts({});
        setIsLoading(false);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }
        setError(
          requestError instanceof Error &&
            (requestError.message === "Judge access required." ||
              requestError.message === "Invalid judge workspace response." ||
              requestError.message === "Invalid judge scores response.")
            ? requestError.message
            : "Judge workspace could not be loaded. Please try again.",
        );
        setIsLoading(false);
      });
    return () => controller.abort();
  }, [refreshCount]);

  async function submitReview(projectId: string) {
    if (!workspace) return;
    const existingScore = scores.find((score) => score.project === projectId);
    const criteria = Object.fromEntries(
      workspace.criteria.map((criterion) => [
        criterion.name,
        scoreDrafts[projectId]?.[criterion.name] ?? existingScore?.criteria[criterion.name] ?? 3,
      ]),
    );
    setIsSaving(true);
    setMessage("");
    setError(null);
    try {
      const result = await sendJson(
        "/api/judge/scores",
        "POST",
        {
          project: projectId,
          criteria,
          comment: commentDrafts[projectId] ?? existingScore?.comment ?? "",
        },
        "Judge access required.",
      );
      if (!isRecord(result) || typeof result.judge !== "string" || typeof result.project !== "string") {
        throw new Error("The review response was invalid.");
      }
      const saved: JudgeScore = {
        judge: result.judge,
        project: result.project,
        criteria,
        comment: commentDrafts[projectId] ?? existingScore?.comment ?? "",
      };
      setScores((current) => [
        ...current.filter((score) => score.project !== projectId),
        saved,
      ]);
      setMessage("Review saved.");
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error && requestError.message === "Judge access required."
          ? requestError.message
          : "Review could not be saved. Check the scores and try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="content judge-content">
      <section className="intro" aria-labelledby="judge-title">
        <p className="eyebrow">JUDGE WORKSPACE</p>
        <h1 id="judge-title">Assigned Projects</h1>
        <p className="intro-copy">Review your assigned projects using the event rubric.</p>
      </section>
      <div className="workspace-actions">
        <span className="session-badge">Judge workspace</span>
        <button type="button" className="secondary-action" onClick={() => setRefreshCount((count) => count + 1)} disabled={isLoading || isSaving}>
          Refresh
        </button>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
      {error ? (
        <div className="notice error-notice organizer-error" role="alert">
          <h2>{error}</h2>
          <button type="button" onClick={() => setRefreshCount((count) => count + 1)}>Try again</button>
        </div>
      ) : isLoading ? (
        <p className="notice" role="status">Loading assigned projects and rubric...</p>
      ) : workspace ? (
        workspace.projects.length === 0 ? (
          <p className="notice organizer-empty">No projects are assigned to this judge.</p>
        ) : workspace.criteria.length === 0 ? (
          <p className="notice organizer-empty">The organizer has not configured a scoring rubric yet.</p>
        ) : (
          <section className="judge-project-list" aria-label="Assigned projects">
            {workspace.projects.map((project) => {
              const savedScore = scores.find((score) => score.project === project.id);
              return (
                <article className="judge-project-card" key={project.id}>
                  <div className="judge-project-heading">
                    <div>
                      <span className="track-tag">{project.track_name}</span>
                      <h2>{project.title}</h2>
                      <p>{project.summary}</p>
                    </div>
                    <span className={savedScore ? "review-status" : "review-status status-pending"}>
                      {savedScore ? "Review saved" : "Not yet reviewed"}
                    </span>
                  </div>
                  {project.repo_url && (
                    <a className="repo-link" href={project.repo_url} target="_blank" rel="noreferrer">
                      View repository
                    </a>
                  )}
                  <div className="rubric-grid">
                    {workspace.criteria.map((criterion) => (
                      <label className="form-field rubric-field" key={criterion.name}>
                        <span>{criterion.name} <small>Weight {criterion.weight}</small></span>
                        <select
                          value={scoreDrafts[project.id]?.[criterion.name] ?? savedScore?.criteria[criterion.name] ?? 3}
                          onChange={(event) => setScoreDrafts((drafts) => ({
                            ...drafts,
                            [project.id]: {
                              ...drafts[project.id],
                              [criterion.name]: Number(event.target.value),
                            },
                          }))}
                          aria-label={`${criterion.name} score for ${project.title}`}
                        >
                          {[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                  <label className="form-field">
                    <span>Comment</span>
                    <textarea
                      value={commentDrafts[project.id] ?? savedScore?.comment ?? ""}
                      onChange={(event) => setCommentDrafts((drafts) => ({ ...drafts, [project.id]: event.target.value }))}
                      placeholder="Add feedback for the team"
                      rows={3}
                    />
                  </label>
                  {savedScore && (
                    <div className="saved-score" aria-label="Your previous score">
                      <strong>Your saved review</strong>
                      <span>{workspace.criteria.map((criterion) => `${criterion.name}: ${savedScore.criteria[criterion.name] ?? "—"}`).join(" · ")}</span>
                      {savedScore.comment && <p>{savedScore.comment}</p>}
                    </div>
                  )}
                  <button type="button" className="primary-action" disabled={isSaving} onClick={() => submitReview(project.id)}>
                    {isSaving ? "Saving review..." : savedScore ? "Update review" : "Submit review"}
                  </button>
                </article>
              );
            })}
          </section>
        )
      ) : null}
    </main>
  );
}

function getExportFilename(disposition: string | null): string {
  const encodedName = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = "dogfood-results.csv";

  try {
    filename = encodedName
      ? decodeURIComponent(encodedName.trim())
      : plainName?.trim() || filename;
  } catch {
    filename = plainName?.trim() || filename;
  }

  return filename.replace(/[\\/:*?"<>|]/g, "_") || "dogfood-results.csv";
}

function OrganizerDashboard() {
  const [progress, setProgress] = useState<ProjectProgress[] | null>(null);
  const [normalizedResults, setNormalizedResults] = useState<NormalizedResult[] | null>(null);
  const [projectSummaries, setProjectSummaries] = useState<ProjectSummary[]>([]);
  const [refreshCount, setRefreshCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setProgress(null);
    setNormalizedResults(null);
    setProjectSummaries([]);
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetchJson("/api/organizer/progress", controller.signal),
      fetchJson("/api/judging/normalized", controller.signal),
      fetchJson("/projects", controller.signal),
    ])
      .then(([progressPayload, resultsPayload, projectsPayload]) => {
        setProgress(parseProgress(progressPayload));
        setNormalizedResults(parseNormalizedResults(resultsPayload));
        setProjectSummaries(parseProjectSummaries(projectsPayload));
        setIsLoading(false);
      })
      .catch((requestError: unknown) => {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        if (requestError instanceof Error) {
          if (
            requestError.message === "Organizer access required." ||
            requestError.message === "Invalid organizer response."
          ) {
            setError(requestError.message);
          } else {
            setError("Organizer data could not be loaded. Please try again.");
          }
        } else {
          setError("Organizer data could not be loaded. Please try again.");
        }
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [refreshCount]);

  async function exportCsv() {
    setIsExporting(true);
    setExportError(null);

    try {
      const response = await fetch("/api/export.csv", {
        credentials: "include",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("Organizer access required.");
        }
        throw new Error("CSV export failed.");
      }

      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getExportFilename(
        response.headers.get("content-disposition"),
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (exportRequestError: unknown) {
      setExportError(
        exportRequestError instanceof Error &&
          exportRequestError.message === "Organizer access required."
          ? exportRequestError.message
          : "CSV export could not be downloaded. Please try again.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  const projectById = new Map(
    projectSummaries.map((project) => [project.id, project]),
  );
  const progressById = new Map(
    (progress ?? []).map((item) => [item.project, item]),
  );
  const totals = (progress ?? []).reduce(
    (summary, item) => ({
      assigned: summary.assigned + item.assigned_judges,
      completed: summary.completed + item.completed_reviews,
      pending: summary.pending + item.pending_reviews,
      reviewedProjects: summary.reviewedProjects + Number(item.completed_reviews > 0),
      pendingProjects: summary.pendingProjects + Number(item.pending_reviews > 0),
    }),
    { assigned: 0, completed: 0, pending: 0, reviewedProjects: 0, pendingProjects: 0 },
  );
  const totalReviews = totals.assigned;
  const reviewPercent = totalReviews > 0
    ? Math.min(100, Math.round((totals.completed / totalReviews) * 100))
    : 0;

  function progressStatus(item: ProjectProgress | undefined): string {
    if (!item) {
      return "Progress unavailable";
    }
    if (item.assigned_judges === 0) {
      return "No judges assigned";
    }
    return item.pending_reviews === 0 ? "Complete" : "In progress";
  }

  return (
    <main className="content organizer-content">
      <section className="intro" aria-labelledby="organizer-title">
        <p className="eyebrow">ORGANIZER DASHBOARD</p>
        <h1 id="organizer-title">Review Progress &amp; Results</h1>
        <p className="intro-copy">
          Track judging progress and review normalized results.
        </p>
      </section>

      <div className="organizer-actions">
        <div className="organizer-actions-note" role="status">
          {isLoading ? "Updating dashboard..." : "Live from DOGFOOD"}
        </div>
        <button
          type="button"
          className="secondary-action"
          onClick={() => setRefreshCount((count) => count + 1)}
          disabled={isLoading}
        >
          Refresh
        </button>
        <button
          type="button"
          className="primary-action"
          onClick={exportCsv}
          disabled={isExporting}
        >
          {isExporting ? "Preparing CSV..." : "Export CSV"}
        </button>
      </div>

      {exportError && <p className="export-error" role="alert">{exportError}</p>}

      {error ? (
        <div className="notice error-notice organizer-error" role="alert">
          <h2>{error === "Organizer access required." ? error : "Dashboard unavailable"}</h2>
          {error !== "Organizer access required." && <p>{error}</p>}
          <button
            type="button"
            onClick={() => setRefreshCount((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <section className="organizer-section" aria-labelledby="progress-title">
            <div className="organizer-section-heading">
              <div>
                <p className="eyebrow">JUDGING ACTIVITY</p>
                <h2 id="progress-title">Review progress</h2>
              </div>
              {progress !== null && !isLoading && (
                <span className="section-count">
                  {progress.length} {progress.length === 1 ? "project" : "projects"}
                </span>
              )}
            </div>

            {isLoading ? (
              <p className="notice organizer-loading" role="status">
                Loading review progress...
              </p>
            ) : progress?.length === 0 ? (
              <p className="notice organizer-empty">
                No submitted projects are available for review yet.
              </p>
            ) : progress ? (
              <>
                <div className="summary-grid">
                  <article className="summary-card">
                    <span>Total submissions</span>
                    <strong>{progress.length}</strong>
                  </article>
                  <article className="summary-card">
                    <span>Projects with reviews</span>
                    <strong>{totals.reviewedProjects}</strong>
                  </article>
                  <article className="summary-card">
                    <span>Projects with pending reviews</span>
                    <strong>{totals.pendingProjects}</strong>
                  </article>
                  <article className="summary-card summary-card-accent">
                    <span>Review completion</span>
                    <strong>{reviewPercent}%</strong>
                  </article>
                </div>

                <div className="review-overview">
                  <div className="review-overview-copy">
                    <strong>Judge review assignments</strong>
                    <span>
                      {totals.completed} completed of {totalReviews} assigned reviews
                    </span>
                  </div>
                  <div
                    className="overall-progress-track"
                    role="progressbar"
                    aria-label="Overall review completion"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={reviewPercent}
                  >
                    <span style={{ width: `${reviewPercent}%` }} />
                  </div>
                  {totalReviews === 0 && (
                    <p>No judge review assignments yet.</p>
                  )}
                </div>

                <div className="progress-list">
                  {progress.map((item) => {
                    const project = projectById.get(item.project);
                    const itemPercent = item.assigned_judges > 0
                      ? Math.min(
                          100,
                          Math.round(
                            (item.completed_reviews / item.assigned_judges) * 100,
                          ),
                        )
                      : 0;

                    return (
                      <article className="progress-row" key={item.project}>
                        <div className="progress-project">
                          <strong>{project?.title ?? item.project}</strong>
                          <span>
                            {project
                              ? `Project ${item.project} · Track ${project.track}`
                              : "Project details unavailable"}
                          </span>
                        </div>
                        <div className="progress-count">
                          <strong>
                            {item.completed_reviews} / {item.assigned_judges}
                          </strong>
                          <span>{item.pending_reviews} pending reviews</span>
                        </div>
                        <div className="project-progress-track" aria-hidden="true">
                          <span style={{ width: `${itemPercent}%` }} />
                        </div>
                        <span className={
                          item.pending_reviews > 0
                            ? "review-status status-pending"
                            : "review-status"
                        }>
                          {progressStatus(item)}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}
          </section>

          <section className="organizer-section results-section" aria-labelledby="normalized-title">
            <div className="organizer-section-heading">
              <div>
                <p className="eyebrow">CROSS-JUDGE NORMALIZATION</p>
                <h2 id="normalized-title">Normalized results</h2>
              </div>
              {normalizedResults !== null && !isLoading && (
                <span className="section-count">
                  {normalizedResults.length} {normalizedResults.length === 1 ? "result" : "results"}
                </span>
              )}
            </div>

            {isLoading ? (
              <p className="notice organizer-loading" role="status">
                Loading normalized results...
              </p>
            ) : normalizedResults?.length === 0 ? (
              <p className="notice organizer-empty">
                No normalized results are available yet.
              </p>
            ) : normalizedResults ? (
              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Track</th>
                      <th scope="col">Normalized score</th>
                      <th scope="col">Reviews</th>
                      <th scope="col">Review status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedResults.map((result) => {
                      const project = projectById.get(result.project);
                      const itemProgress = progressById.get(result.project);

                      return (
                        <tr key={result.project}>
                          <th scope="row">
                            <span className="result-project-title">
                              {project?.title ?? result.project}
                            </span>
                            {project && <span className="result-project-id">{result.project}</span>}
                          </th>
                          <td>{project?.track ?? "Not available"}</td>
                          <td className="score-value">{result.normalized_score.toFixed(2)}</td>
                          <td>{result.reviews}</td>
                          <td>{progressStatus(itemProgress)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [track, setTrack] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"gallery" | "participant" | "judge" | "organizer">(
    () => new URLSearchParams(window.location.search).has("invite")
      ? "participant"
      : "gallery",
  );
  const [demoRole, setDemoRole] = useState<DemoRole>("participant");

  useLayoutEffect(() => {
    document.cookie = `session=${DEMO_SESSIONS[demoRole].token}; Path=/; SameSite=Lax`;
  }, [demoRole]);

  useEffect(() => {
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("q", search.trim());
      }

      if (track) {
        params.set("track", track);
      }

      const query = params.toString();

      setIsLoading(true);
      setError(null);

      fetch(query ? "/projects?" + query : "/projects", {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(
              "Projects could not be loaded. Please try again.",
            );
          }

          return response.json() as Promise<Project[]>;
        })
        .then((results) => {
          setProjects(
            results.filter(
              (project) => project.status === "submitted",
            ),
          );

          setTracks((current) =>
            current.length > 0
              ? current
              : [
                  ...new Set(
                    results.map((project) => project.track),
                  ),
                ].sort(),
          );

          setIsLoading(false);
        })
        .catch((requestError: unknown) => {
          if (
            requestError instanceof DOMException &&
            requestError.name === "AbortError"
          ) {
            return;
          }

          setError(
            requestError instanceof Error
              ? requestError.message
              : "Projects could not be loaded. Please try again.",
          );

          setIsLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, track, retryCount]);

  return (
    <div className="site-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="DOGFOOD home"
          onClick={(event) => {
            event.preventDefault();
            setView("gallery");
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            D
          </span>

          <span>DOGFOOD</span>
        </a>

        <nav aria-label="Main navigation">
          <button
            type="button"
            className={
              view === "gallery"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setView("gallery")}
          >
            Project Gallery
          </button>

          <button
            type="button"
            className={
              view === "participant"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setView("participant")}
          >
            Participant Workspace
          </button>

          <button
            type="button"
            className={
              view === "judge"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setView("judge")}
          >
            Judge Workspace
          </button>

          <button
            type="button"
            className={
              view === "organizer"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setView("organizer")}
          >
            Organizer
          </button>
        </nav>

        <div className="header-tools">
          <label className="demo-role-switcher">
            <span>LOCAL / DEMO ROLE</span>
            <select
              value={demoRole}
              onChange={(event) => setDemoRole(event.target.value as DemoRole)}
              aria-label="Local demo role"
            >
              {Object.entries(DEMO_SESSIONS).map(([role, session]) => (
                <option key={role} value={role}>{session.label}</option>
              ))}
            </select>
          </label>
          <span className="event-label">HACKATHON 2026</span>
        </div>
      </header>

      {view === "gallery" ? (
        <main className="content">
          <section
            className="intro"
            aria-labelledby="page-title"
          >
            <p className="eyebrow">
              THE SHOWCASE
            </p>

            <h1 id="page-title">
              Project Gallery
            </h1>

            <p className="intro-copy">
              Explore what teams have built at DOGFOOD.
            </p>
          </section>

          <section
            className="gallery"
            aria-label="Submitted projects"
          >
            <div className="gallery-toolbar">
              <label className="search-field">
                <span className="visually-hidden">
                  Search projects
                </span>

                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    cx="10.8"
                    cy="10.8"
                    r="6.8"
                  />

                  <path d="m16 16 4.5 4.5" />
                </svg>

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search projects"
                />
              </label>

              {tracks.length > 0 && (
                <label className="track-field">
                  <span className="visually-hidden">
                    Filter by track
                  </span>

                  <select
                    value={track}
                    onChange={(event) =>
                      setTrack(event.target.value)
                    }
                  >
                    <option value="">
                      All tracks
                    </option>

                    {tracks.map((trackId) => (
                      <option
                        key={trackId}
                        value={trackId}
                      >
                        {trackId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {error ? (
              <div
                className="notice error-notice"
                role="alert"
              >
                <h2>
                  We could not reach the gallery
                </h2>

                <p>{error}</p>

                <button
                  type="button"
                  onClick={() =>
                    setRetryCount(
                      (count) => count + 1,
                    )
                  }
                >
                  Try again
                </button>
              </div>
            ) : isLoading ? (
              <p
                className="notice"
                role="status"
              >
                Loading submitted projects...
              </p>
            ) : projects.length === 0 ? (
              <div className="notice empty-notice">
                <span
                  className="empty-mark"
                  aria-hidden="true"
                >
                  0
                </span>

                <h2>
                  No projects found
                </h2>

                <p>
                  Try another search or choose a
                  different track.
                </p>
              </div>
            ) : (
              <>
                <div className="results-heading">
                  <h2>
                    Submitted projects
                  </h2>

                  <span>
                    {projects.length}{" "}
                    {projects.length === 1
                      ? "project"
                      : "projects"}
                  </span>
                </div>

                <div className="project-grid">
                  {projects.map((project) => (
                    <article
                      className="project-card"
                      key={project.id}
                    >
                      <div className="card-meta">
                        <span className="track-tag">
                          {project.track}
                        </span>

                        {project.submitted_at && (
                          <time
                            dateTime={
                              project.submitted_at
                            }
                          >
                            {formatSubmittedDate(
                              project.submitted_at,
                            )}
                          </time>
                        )}
                      </div>

                      <h3>
                        {project.title}
                      </h3>

                      <p className="project-summary">
                        {project.summary}
                      </p>

                      {project.repo_url && (
                        <a
                          className="repo-link"
                          href={project.repo_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View repository

                          <svg
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path d="M7 4h9v9M16 4 8 12" />
                            <path d="M14 11v4H4V5h4" />
                          </svg>
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
        </main>
      ) : view === "participant" ? (
        <ParticipantWorkspace key={demoRole} />
      ) : view === "judge" ? (
        <JudgeWorkspace key={demoRole} />
      ) : (
        <OrganizerDashboard key={demoRole} />
      )}

      <footer className="footer">
        <span>DOGFOOD</span>

        <span>
          Built together, shared here.
        </span>
      </footer>
    </div>
  );
}