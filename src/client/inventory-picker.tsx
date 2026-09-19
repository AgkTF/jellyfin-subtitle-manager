import { useEffect, useRef, useState } from "react";

import type {
  InventoryRefreshResult,
  SavedInventory,
  SavedVideoIdentity,
  SubtitleEvidence,
} from "../server/inventory-contract.js";

import "./inventory-picker.css";

type InventoryState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; inventory: SavedInventory };

type RefreshState =
  | { status: "idle" | "refreshing" | "success" }
  | { status: "partial"; scannedAt: string }
  | { status: "failed"; message: string; retainedScannedAt?: string };

function LanguageEvidence({ language, evidence }: { language: string; evidence: SubtitleEvidence }) {
  return (
    <section className="language-evidence">
      <h4>{language} · {evidence.status === "unknown" ? "Unknown" : "Unverified"}</h4>
      <p>{evidence.description}</p>
    </section>
  );
}

function IdentityEvidence({ identity }: { identity: SavedVideoIdentity }) {
  return (
    <section aria-label="Selected identity evidence" className="identity-evidence">
      <h3>{identity.title}</h3>
      <dl>
        <dt>Release identity</dt>
        <dd className="file-identity">{identity.release}</dd>
        <dt>Association evidence</dt>
        <dd>{identity.association}</dd>
      </dl>
      <div className="language-evidence-grid">
        <LanguageEvidence language="English" evidence={identity.english} />
        <LanguageEvidence language="Arabic" evidence={identity.arabic} />
      </div>
    </section>
  );
}

export function InventoryPicker({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState({ query: "", attempt: 0 });
  const [state, setState] = useState<InventoryState>({ status: "loading" });
  const [refreshState, setRefreshState] = useState<RefreshState>({ status: "idle" });
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    searchRef.current?.focus();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/inventory?q=${encodeURIComponent(submittedSearch.query)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved inventory could not be loaded");
        const inventory = await response.json() as SavedInventory;
        if (!controller.signal.aborted) setState({ status: "ready", inventory });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed" });
      });
    return () => controller.abort();
  }, [submittedSearch]);

  function closePicker() {
    dialogRef.current?.close();
    onClose();
  }

  async function refreshInventory() {
    if (refreshState.status === "refreshing") return;
    setRefreshState({ status: "refreshing" });
    try {
      const response = await fetch("/api/inventory/refresh", { method: "POST" });
      if (!response.ok) throw new Error(`Refresh failed with ${response.status}`);
      const result = await response.json() as InventoryRefreshResult;
      if (result.outcome === "failed") {
        setRefreshState({
          status: "failed",
          message: result.error,
          retainedScannedAt: result.retainedScannedAt,
        });
        return;
      }
      setSelectedVideoId(null);
      setSelectedIdentityId(null);
      setState({ status: "ready", inventory: result.inventory });
      setRefreshState(result.outcome === "partial"
        ? { status: "partial", scannedAt: result.inventory.scannedAt }
        : { status: "success" });
    } catch {
      setRefreshState({
        status: "failed",
        message: "The synthetic refresh request could not be completed.",
      });
    }
  }

  const inventory = state.status === "ready" ? state.inventory : null;
  const video = inventory?.videos.find((item) => item.id === selectedVideoId);
  const identity = video?.identities.find((item) => item.id === selectedIdentityId);

  return (
    <dialog
      aria-labelledby="inventory-picker-title"
      aria-describedby="inventory-picker-description"
      className="inventory-picker"
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); closePicker(); }}
    >
      <header className="picker-heading">
        <div>
          <span className="eyebrow">Synthetic saved inventory</span>
          <h2 id="inventory-picker-title">Inspect saved inventory</h2>
        </div>
        <button className="secondary-button" onClick={closePicker} type="button">Close picker</button>
      </header>
      <div className="refresh-toolbar">
        <p id="inventory-picker-description" className="picker-intro">
          Search saved evidence, then inspect a video. Refresh runs only when you choose and remains synthetic.
        </p>
        <button className="secondary-button" disabled={refreshState.status === "refreshing"}
          onClick={() => { void refreshInventory(); }} type="button">
          {refreshState.status === "refreshing" ? "Refreshing…" : "Refresh saved inventory"}
        </button>
      </div>
      {refreshState.status === "refreshing" && <p role="status">Refreshing synthetic inventory…</p>}
      {refreshState.status === "success" && <p className="refresh-result" role="status">
        Refresh complete. Saved evidence was replaced.
      </p>}
      {refreshState.status === "partial" && <p className="load-error" role="alert">
        Refresh completed with errors. The saved scan at {refreshState.scannedAt} is partial; review its retained scan errors.
      </p>}
      {refreshState.status === "failed" && <p className="load-error" role="alert">
        Refresh failed: {refreshState.message} Previous saved evidence
        {refreshState.retainedScannedAt === undefined ? "" : ` from ${refreshState.retainedScannedAt}`} is still displayed and was not newly verified.
      </p>}
      <form className="inventory-search" onSubmit={(event) => {
        event.preventDefault();
        setSelectedVideoId(null);
        setSelectedIdentityId(null);
        setRefreshState({ status: "idle" });
        setState({ status: "loading" });
        setSubmittedSearch({ query: search.trim(), attempt: submittedSearch.attempt + 1 });
      }}>
        <label htmlFor="inventory-search">Search saved inventory</label>
        <div>
          <input id="inventory-search" type="search" maxLength={200} ref={searchRef} value={search}
            placeholder="Title, release or file" onChange={(event) => setSearch(event.target.value)} />
          <button className="primary-button" type="submit">Search</button>
        </div>
      </form>
      {state.status === "loading" && <p role="status">Loading saved inventory…</p>}
      {state.status === "failed" && (
        <p className="load-error" role="alert">Saved inventory could not be loaded. Search again to retry.</p>
      )}
      {inventory !== null && (
        <>
          <section aria-label="Saved scan" className="scan-evidence">
            <p>Saved scan: <time dateTime={inventory.scannedAt}>{inventory.scannedAt}</time></p>
            <details open>
              <summary>Retained scan errors ({inventory.errors.length})</summary>
              <ul>{inventory.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </details>
          </section>
          <p role="status">{inventory.videos.length} saved {inventory.videos.length === 1 ? "video" : "videos"}</p>
          {inventory.videos.length === 0 && <p>No saved videos match. Try another title, release or file.</p>}
          <ul aria-label="Saved videos" className="inventory-results">
            {inventory.videos.map((item) => (
              <li key={item.id}>
                <button type="button" aria-pressed={video?.id === item.id} onClick={() => {
                  setSelectedVideoId(item.id);
                  setSelectedIdentityId(item.identities.length === 1 ? item.identities[0].id : null);
                }}>
                  <span>{item.identities.length === 1 ? `Inspect ${item.identities[0].title}`
                    : item.identities.length === 0 ? "Inspect unidentified video" : "Inspect ambiguous video"}</span>
                  <span className="file-identity">{item.file.split("/").at(-1)}</span>
                </button>
              </li>
            ))}
          </ul>
          {video !== undefined && (
            <section aria-label="Selected video" className="video-inspection">
              <h3>Saved video evidence</h3>
              <dl>
                <dt>Video file</dt>
                <dd className="file-identity">{video.file}</dd>
              </dl>
              {video.issues.length > 0 && (
                <div className="scan-evidence">
                  <strong>Retained video errors</strong>
                  <ul>{video.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                </div>
              )}
              {video.identities.length === 0 && (
                <>
                  <p>File/release identity is unknown. No possible identity was retained.</p>
                  <div className="language-evidence-grid">
                    {["English", "Arabic"].map((language) => <LanguageEvidence key={language} language={language}
                      evidence={{ status: "unknown", description: "Evidence is incomplete. Subtitle availability is unknown, not confirmed absent." }} />)}
                  </div>
                </>
              )}
              {video.identities.length > 1 && (
                <fieldset className="identity-options">
                  <legend>Possible identities</legend>
                  <p>{identity === undefined
                    ? "Choose an identity. Saved evidence is ambiguous; no identity has been selected."
                    : "Identity selected for inspection only. Ambiguity in the saved evidence remains."}</p>
                  {video.identities.map((option) => (
                    <label key={option.id}>
                      <input type="radio" name="video-identity" value={option.id}
                        checked={selectedIdentityId === option.id}
                        onChange={() => setSelectedIdentityId(option.id)} />
                      <span><strong>{option.title}</strong>
                        <span className="file-identity">{option.release}</span>
                        <span>{option.association}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {identity !== undefined && <IdentityEvidence identity={identity} />}
              <footer className="picker-footer">
                <p>Inspection only. Creating requests is not available in this step.</p>
                <button className="primary-button" type="button" disabled>Create request</button>
              </footer>
            </section>
          )}
        </>
      )}
    </dialog>
  );
}
