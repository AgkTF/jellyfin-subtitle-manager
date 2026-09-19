import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

type RequestGroup = "active" | "deferred" | "finished";

interface RequestLists {
  active: unknown[];
  deferred: unknown[];
}

const groups = ["active", "deferred", "finished"] as const;
const groupLabels: Record<RequestGroup, string> = {
  active: "Active",
  deferred: "Deferred",
  finished: "Finished",
};
const groupIcons: Record<RequestGroup, string> = {
  active: "●",
  deferred: "Ⅱ",
  finished: "✓",
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

  return (
    <div className="workspace-canvas">
      <section aria-label="Subtitle review workspace" className="workspace-shell">
        <aside aria-label="Workspace rail" className="icon-rail">
          <div aria-label="Subtitle manager" className="brand-mark">
            S
          </div>
          <div aria-hidden="true" className="rail-button is-active" title="Requests">
            ◎
          </div>
          <div aria-hidden="true" className="rail-button rail-library" title="Library evidence">
            ▤
          </div>
          <div aria-hidden="true" className="rail-button rail-history" title="Operation history">
            ↺
          </div>
          <div aria-hidden="true" className="rail-button rail-settings" title="Settings">
            ⚙
          </div>
        </aside>

        <aside aria-label="Request navigation" className="workspace-navigation">
          <header className="product-name">
            <strong>Subtitle manager</strong>
            <span>Local review workspace</span>
          </header>

          <span className="navigation-label">Workspace</span>
          <nav aria-label="Workspace">
            <div aria-current="page" className="navigation-item is-active">
              <span className="navigation-icon" aria-hidden="true">◎</span>
              <span>Requests</span>
              <span className="navigation-count">{counts.active}</span>
            </div>
            <div className="navigation-item is-unavailable">
              <span className="navigation-icon" aria-hidden="true">▤</span>
              <span>Library evidence</span>
            </div>
            <div className="navigation-item is-unavailable">
              <span className="navigation-icon" aria-hidden="true">↺</span>
              <span>Operation history</span>
            </div>
          </nav>

          <span className="navigation-label">Request groups</span>
          <nav aria-label="Requests" className="request-groups">
            {groups.map((group) => (
              <button
                aria-label={`${groupLabels[group]} ${counts[group]}`}
                aria-pressed={selectedGroup === group}
                className={`group-button ${selectedGroup === group ? "is-active" : ""}`}
                key={group}
                onClick={() => setSelectedGroup(group)}
                type="button"
              >
                <span className="navigation-icon" aria-hidden="true">{groupIcons[group]}</span>
                <span>{groupLabels[group]}</span>
                <span className="navigation-count">{counts[group]}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-note">
            <strong>Local workspace</strong>
            <br />
            Library scans and request work start only when you choose.
          </div>
        </aside>

        <main className="request-ledger">
          <header className="topbar">
            <div className="breadcrumb" aria-label="Breadcrumb">
              Workspace <span aria-hidden="true">/</span> <strong>Requests</strong>
            </div>
          </header>

          <div className="ledger-content">
            <header className="ledger-heading">
              <div>
                <span className="eyebrow">Request ledger</span>
                <h1>Subtitle requests</h1>
                <p>Review, publish, then verify each subtitle in Jellyfin.</p>
              </div>
            </header>

            <section aria-labelledby="request-group-heading" className="request-panel">
              <header className="panel-heading">
                <div>
                  <h2 id="request-group-heading">{selectedLabel} requests</h2>
                  <p>
                    {counts[selectedGroup]} {counts[selectedGroup] === 1 ? "request" : "requests"}
                  </p>
                </div>
                <div aria-label="Request groups" className="queue-tabs" role="tablist">
                  {groups.map((group) => (
                    <button
                      aria-selected={selectedGroup === group}
                      className={selectedGroup === group ? "is-active" : ""}
                      key={group}
                      onClick={() => setSelectedGroup(group)}
                      role="tab"
                      type="button"
                    >
                      {groupLabels[group]} · {counts[group]}
                    </button>
                  ))}
                </div>
              </header>

              <div aria-label={`${selectedLabel} subtitle requests`} role="table">
                <div className="request-table-heading" role="row">
                  <span role="columnheader">Title and release</span>
                  <span role="columnheader">Language</span>
                  <span role="columnheader">State / next action</span>
                  <span aria-hidden="true" />
                </div>
                {loadFailed ? (
                  <div className="load-error" role="alert">
                    Request history could not be loaded. Reload to try again.
                  </div>
                ) : (
                  <div className="empty-request-group">Nothing in this request group.</div>
                )}
              </div>
            </section>
          </div>
        </main>
      </section>
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
