import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type RequestGroup = "active" | "deferred" | "finished";

interface RequestLists {
  active: unknown[];
  deferred: unknown[];
}

const groupLabels: Record<RequestGroup, string> = {
  active: "Active",
  deferred: "Deferred",
  finished: "Finished",
};

function isRequestLists(value: unknown): value is RequestLists {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const lists = value as Partial<RequestLists>;
  return Array.isArray(lists.active) && Array.isArray(lists.deferred);
}

function RequestWorkspace() {
  const [selectedGroup, setSelectedGroup] = useState<RequestGroup>("active");
  const [requestLists, setRequestLists] = useState<RequestLists>({
    active: [],
    deferred: [],
  });
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/requests", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Request list failed with ${response.status}`);
        }
        const body: unknown = await response.json();
        if (!isRequestLists(body)) {
          throw new Error("Request list response was invalid");
        }
        setRequestLists(body);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadFailed(true);
        }
      });

    return () => controller.abort();
  }, []);

  const counts: Record<RequestGroup, number> = {
    active: requestLists.active.length,
    deferred: requestLists.deferred.length,
    finished: 0,
  };
  const selectedLabel = groupLabels[selectedGroup];

  const groupButton = (group: RequestGroup, className: string) => (
    <button
      aria-label={`${groupLabels[group]} ${counts[group]}`}
      aria-pressed={selectedGroup === group}
      className={`${className} ${selectedGroup === group ? "is-selected" : ""}`}
      key={group}
      onClick={() => setSelectedGroup(group)}
      type="button"
    >
      <span>{groupLabels[group]}</span>
      <span className="count">{counts[group]}</span>
    </button>
  );

  return (
    <div className="workspace-shell">
      <aside aria-label="Workspace rail" className="icon-rail">
        <div aria-label="Subtitle manager" className="brand-mark">
          S
        </div>
        <div aria-hidden="true" className="rail-marker">
          ◎
        </div>
      </aside>

      <aside className="workspace-navigation">
        <div className="brand-name">Subtitles</div>
        <p className="navigation-label">Workspace</p>
        <div className="primary-location" aria-current="page">
          <span aria-hidden="true">◎</span>
          <span>Requests</span>
        </div>

        <p className="navigation-label">Request groups</p>
        <nav aria-label="Requests" className="request-groups">
          {(["active", "deferred", "finished"] as const).map((group) =>
            groupButton(group, "group-button"),
          )}
        </nav>
      </aside>

      <main className="request-ledger">
        <header className="ledger-heading">
          <div>
            <p className="eyebrow">Request ledger</p>
            <h1>Subtitle requests</h1>
            <p>Review, publish, then verify each subtitle in Jellyfin.</p>
          </div>
        </header>

        <section aria-labelledby="request-group-heading" className="request-panel">
          <div className="panel-heading">
            <div>
              <h2 id="request-group-heading">{selectedLabel} requests</h2>
              <p>
                {counts[selectedGroup]} {counts[selectedGroup] === 1 ? "request" : "requests"}
              </p>
            </div>
            <div aria-label="Request groups" className="queue-tabs" role="tablist">
              {(["active", "deferred", "finished"] as const).map((group) => (
                <button
                  aria-selected={selectedGroup === group}
                  className={selectedGroup === group ? "is-selected" : ""}
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  role="tab"
                  type="button"
                >
                  {groupLabels[group]} {counts[group]}
                </button>
              ))}
            </div>
          </div>

          {loadFailed ? (
            <div className="load-error" role="alert">
              Request history could not be loaded. Reload to try again.
            </div>
          ) : (
            <div
              aria-label={`${selectedLabel} subtitle requests`}
              className="empty-request-group"
              role="region"
            >
              <span aria-hidden="true">—</span>
              <p>Nothing in this request group.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const root = document.querySelector("#root");

if (!(root instanceof HTMLElement)) {
  throw new Error("Missing application root");
}

createRoot(root).render(
  <StrictMode>
    <RequestWorkspace />
  </StrictMode>,
);
