import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  PreparedCandidateView,
  PreviewOutcome,
  PreviewSampleStatus,
  RequestSummary,
  RequestView,
} from "../server/request-workflow.js";

import { InventoryPicker } from "./inventory-picker.js";

import "./styles.css";

type RequestGroup = "active" | "deferred" | "finished";

interface RequestLists {
  active: RequestSummary[];
  deferred: RequestSummary[];
}

interface ReviewedPublicationContext {
  requestId: string;
  requestVersion: number;
  video: RequestView["video"];
  candidateId: string;
  candidateContentHash: string;
  candidateIdentityEvidenceHash: string;
  destination: string;
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

function DisabledPublicationReview({ request, candidate, candidateWasPreviewed }: {
  request: RequestView;
  candidate: PreparedCandidateView;
  candidateWasPreviewed: boolean;
}) {
  const [reviewedContext, setReviewedContext] = useState<ReviewedPublicationContext | null>(null);
  const [reviewWasInvalidated, setReviewWasInvalidated] = useState(false);
  const reviewedContextIsCurrent = reviewedContext !== null &&
    reviewedContext.requestId === request.id &&
    reviewedContext.requestVersion === request.version &&
    reviewedContext.video.libraryId === request.video.libraryId &&
    reviewedContext.video.id === request.video.id &&
    reviewedContext.candidateId === candidate.id &&
    reviewedContext.candidateContentHash === candidate.contentHash &&
    reviewedContext.candidateIdentityEvidenceHash === candidate.identityEvidenceHash &&
    reviewedContext.destination === candidate.destination;

  useEffect(() => {
    if (reviewedContext !== null && !reviewedContextIsCurrent) {
      setReviewedContext(null);
      setReviewWasInvalidated(true);
    }
  }, [reviewedContext, reviewedContextIsCurrent]);

  function reviewPublicationProposal() {
    if (request.lifecycle !== "active" || candidate.attachment === null || !candidateWasPreviewed) return;
    setReviewedContext({
      requestId: request.id,
      requestVersion: request.version,
      video: request.video,
      candidateId: candidate.id,
      candidateContentHash: candidate.contentHash,
      candidateIdentityEvidenceHash: candidate.identityEvidenceHash,
      destination: candidate.destination,
    });
    setReviewWasInvalidated(false);
  }

  return <>
    <section aria-label="Publication approval" className="publication-approval">
      <span className="eyebrow">Publication</span>
      <h3>Review exact publication approval</h3>
      <p className="publication-state"><strong>Not published · publication unavailable in Slice 1</strong></p>
      <p>Preview evidence above is separate from publication. Reviewing this context grants no approval and starts no operation.</p>
      {reviewWasInvalidated && (
        <p className="approval-invalidated" role="alert">
          The previously reviewed publication context is no longer current. Review the current candidate, destination, and request version again.
        </p>
      )}
      {reviewedContextIsCurrent && reviewedContext !== null && (
        <div aria-label="Exact publication context" className="publication-context">
          <dl>
            <dt>Request</dt>
            <dd>{reviewedContext.requestId} · Request version {reviewedContext.requestVersion}</dd>
            <dt>Video evidence</dt>
            <dd>{reviewedContext.video.label} · locator {reviewedContext.video.id} · library {reviewedContext.video.libraryId}</dd>
            <dt>Candidate ID</dt>
            <dd>{reviewedContext.candidateId}</dd>
            <dt>Candidate content SHA-256</dt>
            <dd className="publication-exact-value">{reviewedContext.candidateContentHash}</dd>
            <dt>Candidate identity evidence hash</dt>
            <dd className="publication-exact-value">{reviewedContext.candidateIdentityEvidenceHash}</dd>
            <dt>Exact proposed destination</dt>
            <dd className="publication-exact-value">{reviewedContext.destination}</dd>
          </dl>
          <p className="approval-boundary">Publication would add this exact candidate as a new sidecar without replacing any existing subtitle, without modifying the media file or changing track defaults. The destination must remain unoccupied.</p>
          <button aria-describedby="publication-disabled-explanation" className="primary-button" disabled type="button">
            Approve and publish — unavailable in Slice 1
          </button>
          <p id="publication-disabled-explanation">No publication operation has been created. Slice 1 cannot write a file or report publication success.</p>
        </div>
      )}
      {!reviewedContextIsCurrent && (
        <button className="secondary-button" disabled={!candidateWasPreviewed || request.lifecycle !== "active"}
          onClick={reviewPublicationProposal} type="button">
          Review publication approval
        </button>
      )}
      {!candidateWasPreviewed && (
        <p>Record preview evidence for this exact candidate before reviewing its publication context.</p>
      )}
      {request.lifecycle !== "active" && (
        <p>Return this request to active attention before reviewing a new publication context.</p>
      )}
    </section>
    <section aria-label="Client verification" className="client-verification">
      <span className="eyebrow">Client verification</span>
      <h3>Jellyfin verification unavailable</h3>
      <p>No Jellyfin check is pending. Client verification starts only after a separately enabled publication has been verified; preview observations do not create this state.</p>
    </section>
  </>;
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
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [rejectionInProgress, setRejectionInProgress] = useState<string | null>(null);
  const [recoveryInProgress, setRecoveryInProgress] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [previewClient, setPreviewClient] = useState("Existing desktop player");
  const [previewOutcome, setPreviewOutcome] = useState<PreviewOutcome>("inconclusive");
  const [previewSample, setPreviewSample] = useState<Record<"beginning" | "middle" | "end", PreviewSampleStatus>>({
    beginning: "not-checked",
    middle: "not-checked",
    end: "not-checked",
  });
  const [previewNote, setPreviewNote] = useState("");
  const [observationInProgress, setObservationInProgress] = useState(false);
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
  const rejectedCandidateCount = selectedRequest?.preparation?.candidates.filter(
    (candidate) => candidate.rejection !== null,
  ).length ?? 0;
  const preparedCandidates = selectedRequest?.preparation?.candidates ?? [];
  const selectedCandidate = preparedCandidates.find((candidate) =>
    candidate.id === selectedCandidateId && candidate.rejection === null,
  ) ?? preparedCandidates.find((candidate) =>
    candidate.id === selectedRequest?.preparation?.recommendedCandidateId && candidate.rejection === null,
  ) ?? preparedCandidates.find((candidate) => candidate.rejection === null);
  const selectedCandidateWasPreviewed = selectedRequest !== null && selectedCandidate !== undefined &&
    (selectedRequest.previewObservations ?? []).some((observation) =>
      observation.video.libraryId === selectedRequest.video.libraryId &&
      observation.video.id === selectedRequest.video.id &&
      observation.candidateId === selectedCandidate.id &&
      observation.candidateContentHash === selectedCandidate.contentHash,
    );
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
    setSelectedCandidateId(null);
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

  async function retryPreparation() {
    if (selectedRequest === null || selectedRequest.lifecycle !== "active" || preparationInProgress) return;
    setPreparationInProgress(true);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(selectedRequest.id)}/retry-preparation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: selectedRequest.version }),
      });
      if (response.status === 409) {
        setTransitionConflict(true);
        return;
      }
      if (!response.ok) throw new Error(`Preparation retry failed with ${response.status}`);
      setSelectedRequest(await response.json() as RequestView);
      setTransitionConflict(false);
    } catch {
      setDetailFailed(true);
    } finally {
      setPreparationInProgress(false);
    }
  }

  async function recordPreviewObservation() {
    const candidate = selectedCandidate;
    if (selectedRequest === null || candidate === undefined || candidate.attachment === null || observationInProgress) return;
    setObservationInProgress(true);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(selectedRequest.id)}/preview-observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: selectedRequest.version,
          attachmentId: candidate.attachment.id,
          client: previewClient,
          outcome: previewOutcome,
          sample: previewSample,
          note: previewNote,
        }),
      });
      if (response.status === 409) {
        setTransitionConflict(true);
        return;
      }
      if (!response.ok) throw new Error(`Preview observation failed with ${response.status}`);
      setSelectedRequest(await response.json() as RequestView);
      setPreviewNote("");
      setTransitionConflict(false);
    } catch {
      setDetailFailed(true);
    } finally {
      setObservationInProgress(false);
    }
  }

  async function rejectCandidate(candidate: PreparedCandidateView) {
    if (selectedRequest === null || selectedRequest.lifecycle !== "active" ||
        candidate.rejection !== null || rejectionInProgress !== null) return;
    const reason = rejectionReasons[candidate.id]?.trim() ?? "";
    if (reason.length === 0) return;
    setRejectionInProgress(candidate.id);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/requests/${encodeURIComponent(selectedRequest.id)}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: selectedRequest.version,
          candidateId: candidate.id,
          identityEvidenceHash: candidate.identityEvidenceHash,
          reason,
        }),
      });
      if (response.status === 409) {
        setTransitionConflict(true);
        return;
      }
      if (!response.ok) throw new Error(`Candidate rejection failed with ${response.status}`);
      setSelectedRequest(await response.json() as RequestView);
      setSelectedCandidateId(null);
      setRejectionReasons((current) => ({ ...current, [candidate.id]: "" }));
      setTransitionConflict(false);
    } catch {
      setDetailFailed(true);
    } finally {
      setRejectionInProgress(null);
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
                    <h3>Preparation result</h3>
                    <p><strong>Outcome:</strong> {selectedRequest.preparation.outcome}</p>
                    <p>{selectedRequest.preparation.explanation}</p>
                    <p>Provider and network activity: none. Only the selected candidate can be downloaded as an application-owned attachment.</p>
                    {selectedRequest.preparation.nextActions.includes("retry") && selectedRequest.lifecycle === "active" && (
                      <button className="secondary-button" disabled={preparationInProgress || transitionConflict}
                        onClick={() => { void retryPreparation(); }} type="button">
                        {preparationInProgress ? "Retrying preparation…" : "Retry preparation"}
                      </button>
                    )}
                    {selectedRequest.preparation.outcome === "candidates-found" && <>
                      <p><strong>Recommendation:</strong> {selectedRequest.preparation.recommendedCandidateId === null
                        ? "No current recommendation; the prior recommendation was rejected."
                        : selectedRequest.preparation.candidates.find((candidate) =>
                          candidate.id === selectedRequest.preparation?.recommendedCandidateId)?.recommendationReason}</p>
                      <p>{rejectedCandidateCount} rejected candidate{rejectedCandidateCount === 1 ? "" : "s"}</p>
                    </>}
                    {selectedRequest.preparation.candidates.length > 0 && <ol>
                      {selectedRequest.preparation.candidates.map((candidate) => {
                        const isRecommended = candidate.id === selectedRequest.preparation?.recommendedCandidateId;
                        const reason = rejectionReasons[candidate.id] ?? "";
                        return (
                          <li key={candidate.id}>
                            <button className="secondary-button candidate-select" disabled={candidate.rejection !== null}
                              aria-pressed={selectedCandidate?.id === candidate.id}
                              onClick={() => setSelectedCandidateId(candidate.id)} type="button">
                              {selectedCandidate?.id === candidate.id ? "Selected candidate" : `Select ${candidate.label}`}
                            </button>
                            <strong>{candidate.label}{candidate.rejection !== null
                              ? " · Rejected"
                              : isRecommended ? " · Recommended" : " · Alternative"}</strong>
                            <dl>
                              <dt>Candidate ID</dt><dd>{candidate.id}</dd>
                              <dt>Content SHA-256</dt><dd className="file-identity">{candidate.contentHash}</dd>
                              <dt>Identity evidence hash</dt><dd className="file-identity">{candidate.identityEvidenceHash}</dd>
                              <dt>File / release association</dt><dd>{candidate.file} · {candidate.release}</dd>
                              <dt>Language / type</dt><dd>{languageLabel(candidate.language)} · {candidate.subtitleType}</dd>
                              <dt>Provenance / authorship</dt><dd>{candidate.provenance}; {candidate.language === "ar" ? "Arabic authorship remains unknown" : "authorship remains unknown"}</dd>
                              <dt>Timing evidence</dt><dd>{candidate.timing.status}: {candidate.timing.evidence} {candidate.timing.limits}</dd>
                              <dt>Proposed destination</dt><dd>{candidate.destination} · publication is not enabled</dd>
                            </dl>
                            {candidate.rejection === null && selectedRequest.lifecycle === "active" ? (
                              <div className="candidate-rejection">
                                <label htmlFor={`rejection-${candidate.identityEvidenceHash}`}>Reason for rejecting {candidate.label}</label>
                                <textarea id={`rejection-${candidate.identityEvidenceHash}`} maxLength={1000} value={reason}
                                  onChange={(event) => setRejectionReasons((current) => ({
                                    ...current,
                                    [candidate.id]: event.target.value,
                                  }))} />
                                <button className="secondary-button"
                                  disabled={reason.trim().length === 0 || rejectionInProgress !== null || transitionConflict}
                                  onClick={() => { void rejectCandidate(candidate); }} type="button">
                                  {rejectionInProgress === candidate.id ? "Rejecting…" : `Reject ${candidate.label}`}
                                </button>
                              </div>
                            ) : candidate.rejection !== null ? (
                              <p className="candidate-rejected"><strong>Rejected:</strong> {candidate.rejection.reason}</p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>}
                    {selectedCandidate?.attachment !== null && selectedCandidate?.attachment !== undefined && (
                      <section aria-label="Selected candidate preview" className="candidate-preview">
                        <h3>Preview selected candidate</h3>
                        <p><strong>Selected video:</strong> {selectedRequest.video.label} · locator {selectedRequest.video.id}
                          (library {selectedRequest.video.libraryId})</p>
                        <p><strong>Candidate:</strong> {selectedCandidate.id} · <strong>Content SHA-256:</strong> {selectedCandidate.contentHash}</p>
                        <p><strong>Local subtitle filename:</strong> {selectedCandidate.attachment.filename}</p>
                        <a className="primary-button" download={selectedCandidate.attachment.filename}
                          href={selectedCandidate.attachment.downloadUrl}>Download selected candidate attachment</a>
                        <h4>Load and check manually</h4>
                        <p>1. In the existing desktop player, explicitly load the downloaded <strong>{selectedCandidate.attachment.filename}</strong> for the selected video.</p>
                        <p>2. Check a targeted sample near the beginning, then one in the middle and one near the end.</p>
                        <p>3. Record only what you observed; exhaustive review, automatic player control, and publication are not part of this step.</p>
                        <p className="preview-boundary">This is a user report for the named client and samples. It is not proof of what the player loaded, full-dialogue coverage, synchronization outside the samples, human authorship, acceptance, or publication approval.</p>
                        <div className="preview-observation-form">
                          <label htmlFor="preview-client">Client used</label>
                          <input id="preview-client" maxLength={200} value={previewClient}
                            onChange={(event) => setPreviewClient(event.target.value)} />
                          <label htmlFor="preview-outcome">Preview outcome</label>
                          <select id="preview-outcome" value={previewOutcome}
                            onChange={(event) => setPreviewOutcome(event.target.value as PreviewOutcome)}>
                            <option value="usable">Usable in these samples</option>
                            <option value="not-usable">Not usable in these samples</option>
                            <option value="inconclusive">Inconclusive</option>
                          </select>
                          {(["beginning", "middle", "end"] as const).map((sample) => (
                            <label key={sample} htmlFor={`preview-${sample}`}>{sample[0].toUpperCase() + sample.slice(1)} sample
                              <select id={`preview-${sample}`} value={previewSample[sample]}
                                onChange={(event) => setPreviewSample((current) => ({
                                  ...current, [sample]: event.target.value as PreviewSampleStatus,
                                }))}>
                                <option value="checked">Checked</option>
                                <option value="not-checked">Not checked</option>
                                <option value="failed">Check failed</option>
                              </select>
                            </label>
                          ))}
                          <label htmlFor="preview-note">Observation note (optional)</label>
                          <textarea id="preview-note" maxLength={2000} value={previewNote}
                            onChange={(event) => setPreviewNote(event.target.value)} />
                          <button className="secondary-button" disabled={observationInProgress || transitionConflict || previewClient.trim().length === 0}
                            onClick={() => { void recordPreviewObservation(); }} type="button">
                            {observationInProgress ? "Recording…" : "Record preview observation"}
                          </button>
                        </div>
                        {(selectedRequest.previewObservations ?? []).length > 0 && (
                          <section aria-label="Recorded preview observations">
                            <h4>Recorded preview observations</h4>
                            <ul>{(selectedRequest.previewObservations ?? []).map((observation) => (
                              <li key={observation.id}>{observation.client} · {observation.outcome} · beginning {observation.sample.beginning}, middle {observation.sample.middle}, end {observation.sample.end}
                                {observation.note === null ? "" : ` · ${observation.note}`}</li>
                            ))}</ul>
                          </section>
                        )}
                      </section>
                    )}
                  </section>
                )}
                {selectedCandidate?.attachment !== null && selectedCandidate?.attachment !== undefined && (
                  <>
                    <DisabledPublicationReview candidate={selectedCandidate}
                      candidateWasPreviewed={selectedCandidateWasPreviewed} request={selectedRequest} />
                  </>
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
