import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { RequestSummary, RequestView } from "../server/request-workflow.js";

import { InventoryPicker } from "./inventory-picker.js";

import "./styles.css";

type RequestGroup = "active" | "deferred" | "finished";

interface RequestLists {
  active: RequestSummary[];
  deferred: RequestSummary[];
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

function languageLabel(language: RequestSummary["language"]): string {
  return language === "en" ? "English" : "Arabic";
}

async function loadRequest(requestId: string): Promise<RequestView> {
  const response = await fetch(`/api/requests/${encodeURIComponent(requestId)}`);
  if (!response.ok) throw new Error(`Request detail failed with ${response.status}`);
  return response.json() as Promise<RequestView>;
}

function RequestWorkspace() {
  const [selectedGroup, setSelectedGroup] = useState<RequestGroup>("active");
  const [requestLists, setRequestLists] = useState<RequestLists>({
    active: [],
    deferred: [],
  });
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestView | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [transitionConflict, setTransitionConflict] = useState(false);
  const [transitionInProgress, setTransitionInProgress] = useState(false);
  const [preparationInProgress, setPreparationInProgress] = useState(false);
  const [recoveryInProgress, setRecoveryInProgress] = useState(false);
  const pickerOpener = useRef<HTMLButtonElement>(null);

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
  const selectedRequests = selectedGroup === "active" ? requestLists.active
    : selectedGroup === "deferred" ? requestLists.deferred : [];

  function updateRequest(request: RequestSummary) {
    setRequestLists((current) => ({
      active: request.lifecycle === "active"
        ? [...current.active.filter((item) => item.id !== request.id), request]
        : current.active.filter((item) => item.id !== request.id),
      deferred: request.lifecycle === "deferred"
        ? [...current.deferred.filter((item) => item.id !== request.id), request]
        : current.deferred.filter((item) => item.id !== request.id),
    }));
    setSelectedGroup(request.lifecycle);
  }

  async function selectRequest(request: RequestSummary) {
    setDetailFailed(false);
    setTransitionConflict(false);
    try {
      setSelectedRequest(await loadRequest(request.id));
    } catch {
      setSelectedRequest(null);
      setDetailFailed(true);
    }
  }

  async function recoverRequest() {
    if (selectedRequest === null || recoveryInProgress) return;
    setRecoveryInProgress(true);
    setDetailFailed(false);
    try {
      const current = await loadRequest(selectedRequest.id);
      setSelectedRequest(current);
      updateRequest(current);
      setTransitionConflict(false);
    } catch {
      setDetailFailed(true);
    } finally {
      setRecoveryInProgress(false);
    }
  }

  async function prepareRequest() {
    if (selectedRequest === null || selectedRequest.lifecycle !== "active" || preparationInProgress) return;
    setPreparationInProgress(true);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(selectedRequest.id)}/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedRequest.version }),
      });
      if (response.status === 409) {
        setTransitionConflict(true);
        return;
      }
      if (!response.ok) throw new Error(`Candidate preparation failed with ${response.status}`);
      setSelectedRequest(await response.json() as RequestView);
    } catch {
      setDetailFailed(true);
    } finally {
      setPreparationInProgress(false);
    }
  }

  async function transitionRequest(action: "defer" | "retry") {
    if (selectedRequest === null || transitionInProgress) return;
    setTransitionInProgress(true);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(selectedRequest.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedRequest.version }),
      });
      if (response.status === 409) {
        setTransitionConflict(true);
        return;
      }
      if (!response.ok) throw new Error(`Request transition failed with ${response.status}`);
      const updated = await response.json() as RequestView;
      setSelectedRequest(updated);
      updateRequest(updated);
      setTransitionConflict(false);
    } catch {
      setDetailFailed(true);
    } finally {
      setTransitionInProgress(false);
    }
  }

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
              <button className="primary-button" ref={pickerOpener} type="button" onClick={() => setPickerOpen(true)}>
                Request subtitles
              </button>
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
                ) : selectedRequests.length === 0 ? (
                  <div className="empty-request-group">Nothing in this request group.</div>
                ) : (
                  selectedRequests.map((request) => (
                    <div className="request-row" key={request.id} onClick={() => { void selectRequest(request); }} role="row">
                      <div role="cell">
                        <strong>{request.video.label}</strong>
                        <span className="request-video-id">{request.video.id}</span>
                      </div>
                      <div role="cell">{languageLabel(request.language)}</div>
                      <div role="cell">
                        <span className="request-state">{groupLabels[request.lifecycle]}</span>
                        <span className="request-state-detail">Lifecycle v{request.version}</span>
                      </div>
                      <div aria-hidden="true" role="cell">›</div>
                    </div>
                  ))
                )}
              </div>
            </section>
            {detailFailed && <p className="load-error" role="alert">Request detail could not be updated. Try again.</p>}
            {transitionConflict && selectedRequest !== null && (
              <div className="request-conflict" role="alert">
                <span>This request changed in another tab. Load current state to continue.</span>
                <button className="secondary-button" disabled={recoveryInProgress}
                  onClick={() => { void recoverRequest(); }} type="button">
                  {recoveryInProgress ? "Loading…" : "Load current state"}
                </button>
              </div>
            )}
            {selectedRequest !== null && (
              <section aria-label="Subtitle request detail" className="request-detail">
                <header>
                  <span className="eyebrow">Subtitle request detail</span>
                  <h2>{selectedRequest.video.label} · {languageLabel(selectedRequest.language)}</h2>
                  <p>{selectedRequest.lifecycle === "active"
                    ? "This request is in active attention."
                    : "This deferred request will return to active attention only when you retry it."}</p>
                </header>
                <section aria-labelledby="lifecycle-history-heading">
                  <h3 id="lifecycle-history-heading">Lifecycle history</h3>
                  <ol>
                    {selectedRequest.lifecycleHistory.map((entry) => (
                      <li key={entry.version}>{groupLabels[entry.lifecycle]} · version {entry.version}</li>
                    ))}
                  </ol>
                </section>
                {selectedRequest.lifecycle === "active" && selectedRequest.preparation === null && (
                  <button className="primary-button" disabled={preparationInProgress || transitionConflict}
                    onClick={() => { void prepareRequest(); }} type="button">
                    {preparationInProgress ? "Preparing…" : "Prepare synthetic candidates"}
                  </button>
                )}
                {selectedRequest.preparation !== null && (
                  <section aria-label="Prepared subtitle candidates" className="candidate-preparation">
                    <h3>Prepared synthetic candidates</h3>
                    <p>Provider and network activity: none. These candidates are synthetic fixtures for review only.</p>
                    <p><strong>Recommendation:</strong> {selectedRequest.preparation.candidates.find((candidate) =>
                      candidate.id === selectedRequest.preparation?.recommendedCandidateId)?.recommendationReason}</p>
                    <ol>
                      {selectedRequest.preparation.candidates.map((candidate) => (
                        <li key={candidate.id}>
                          <strong>{candidate.label}{candidate.id === selectedRequest.preparation?.recommendedCandidateId ? " · Recommended" : " · Alternative"}</strong>
                          <dl>
                            <dt>File / release association</dt><dd>{candidate.file} · {candidate.release}</dd>
                            <dt>Language / type</dt><dd>{languageLabel(candidate.language)} · {candidate.subtitleType}</dd>
                            <dt>Provenance / authorship</dt><dd>{candidate.provenance}; {candidate.language === "ar" ? "Arabic authorship remains unknown" : "authorship remains unknown"}</dd>
                            <dt>Timing evidence</dt><dd>{candidate.timing.status}: {candidate.timing.evidence} {candidate.timing.limits}</dd>
                            <dt>Proposed destination</dt><dd>{candidate.destination} · publication is not enabled</dd>
                          </dl>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                <button className="secondary-button" disabled={transitionInProgress || transitionConflict}
                  onClick={() => { void transitionRequest(selectedRequest.lifecycle === "active" ? "defer" : "retry"); }} type="button">
                  {transitionInProgress ? "Updating…" : selectedRequest.lifecycle === "active" ? "Defer request" : "Retry request"}
                </button>
              </section>
            )}
          </div>
        </main>
      </section>
      {pickerOpen && <InventoryPicker onCreated={updateRequest} onClose={() => {
        setPickerOpen(false);
        pickerOpener.current?.focus();
      }} />}
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
