import { useEffect, useState } from "react";

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

const TRACKS: Track[] = [
  { id: "trk_01", name: "Developer tools" },
  { id: "trk_02", name: "Data and analytics" },
  { id: "trk_03", name: "Accessibility" },
  { id: "trk_04", name: "Security" },
  { id: "trk_05", name: "Climate" },
  { id: "trk_06", name: "Health" },
  { id: "trk_07", name: "Education" },
  { id: "trk_08", name: "Open hardware" },
];

const PARTICIPANT_SESSION = "prt_2e88";

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

async function fetchJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "include",
    signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Organizer access required.");
    }
    throw new Error("Organizer request failed.");
  }

  return (await response.json()) as unknown;
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
                            {project ? `Track ${project.track}` : "Project details unavailable"}
                          </span>
                        </div>
                        <div className="progress-count">
                          <strong>
                            {item.completed_reviews} / {item.assigned_judges}
                          </strong>
                          <span>reviews complete</span>
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

  const [view, setView] = useState<"gallery" | "participant" | "organizer">("gallery");
  const [selectedTrack, setSelectedTrack] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");

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
              view === "organizer"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setView("organizer")}
          >
            Organizer
          </button>
        </nav>

        <span className="event-label">
          HACKATHON 2026
        </span>
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
        <main className="content">
          <section
            className="intro"
            aria-labelledby="participant-title"
          >
            <p className="eyebrow">
              PARTICIPANT AREA
            </p>

            <h1 id="participant-title">
              Participant Workspace
            </h1>

            <p className="intro-copy">
              Manage your hackathon participation and
              project submission.
            </p>
          </section>

          <section
            className="participant-workspace"
            aria-label="Participant workspace"
          >
            <div className="workspace-card">
              <div className="workspace-card-header">
                <div>
                  <p className="eyebrow">
                    PARTICIPANT
                  </p>

                  <h2>
                    Your details
                  </h2>
                </div>

                <span className="session-badge">
                  {PARTICIPANT_SESSION}
                </span>
              </div>

              <div className="workspace-form">
                <label>
                  <span>
                    Name
                  </span>

                  <input
                    type="text"
                    value={participantName}
                    onChange={(event) =>
                      setParticipantName(
                        event.target.value,
                      )
                    }
                    placeholder="Enter your name"
                  />
                </label>

                <label>
                  <span>
                    Email
                  </span>

                  <input
                    type="email"
                    value={participantEmail}
                    onChange={(event) =>
                      setParticipantEmail(
                        event.target.value,
                      )
                    }
                    placeholder="Enter your email"
                  />
                </label>

                <label>
                  <span>
                    Track
                  </span>

                  <select
                    value={selectedTrack}
                    onChange={(event) =>
                      setSelectedTrack(
                        event.target.value,
                      )
                    }
                  >
                    <option value="">
                      Select a track
                    </option>

                    {TRACKS.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="workspace-button"
                  onClick={() => {
                    window.alert(
                      "Participant details saved locally for this session.",
                    );
                  }}
                >
                  Save participant details
                </button>
              </div>
            </div>

            <div className="workspace-card">
              <p className="eyebrow">
                PROJECT
              </p>

              <h2>
                Your submission
              </h2>

              <p className="workspace-description">
                Your project submission area will be
                connected to the DOGFOOD backend next.
              </p>

              <div className="workspace-status">
                <span className="status-dot" />

                <span>
                  Submission workspace ready
                </span>
              </div>
            </div>
          </section>
        </main>
      ) : (
        <OrganizerDashboard />
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