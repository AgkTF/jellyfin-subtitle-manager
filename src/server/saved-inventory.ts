import type {
  InventoryRefreshAttempt,
  InventoryRefreshFailure,
  InventoryRefreshResult,
  SavedInventory,
} from "./inventory-contract.js";

// Deliberately synthetic saved evidence. This read path has no scanner, provider,
// filesystem, or workflow dependency; it never inspects the displayed paths.
const initialInventory: SavedInventory = {
  source: "synthetic",
  scannedAt: "2026-01-15T12:00:00Z",
  errors: ["Synthetic scan: /synthetic/unreadable could not be listed."],
  videos: [
    {
      id: "quiet-orbit",
      file: "/synthetic/Quiet.Orbit.2025.1080p.SYNTHETIC.mkv",
      issues: [],
      identities: [{
        id: "quiet-orbit-2025",
        title: "Quiet Orbit (2025)",
        release: "Quiet.Orbit.2025.1080p.SYNTHETIC",
        association: "Saved filename and container title agree. Synthetic identity evidence only.",
        english: {
          status: "unverified",
          description: "Embedded English text track, labelled full dialogue. Timing and coverage have not been verified.",
        },
        arabic: {
          status: "unknown",
          description: "No Arabic evidence was retained. Availability and human authorship are unknown, not confirmed absent.",
        },
      }],
    },
    {
      id: "harbor-signal",
      file: "/synthetic/Harbor.Signal.SYNTHETIC.mkv",
      issues: ["Saved filename year and container title disagree. Identity remains ambiguous."],
      identities: [
        {
          id: "harbor-signal-2024",
          title: "Harbor Signal (2024)",
          release: "Harbor.Signal.2024.720p.SYNTHETIC",
          association: "Possible identity from saved container title. Sidecar basename is only candidate association evidence.",
          english: {
            status: "unverified",
            description: "Forced-only English sidecar associated by basename. It cannot satisfy the full-dialogue language need.",
          },
          arabic: {
            status: "unknown",
            description: "Sidecar language tags conflict. Arabic availability and authorship remain unknown.",
          },
        },
        {
          id: "harbor-signal-2025",
          title: "Harbor Signal (2025)",
          release: "Harbor.Signal.2025.1080p.SYNTHETIC",
          association: "Possible identity from saved filename evidence; the container title disagrees. Choosing this identity is not verification.",
          english: {
            status: "unknown",
            description: "English evidence is incomplete. Availability is unknown, not confirmed absent.",
          },
          arabic: {
            status: "unverified",
            description: "Arabic image-based track in saved evidence. Timing, full-dialogue coverage and human authorship remain unknown.",
          },
        },
      ],
    },
    {
      id: "cloud-archive",
      file: "/synthetic/Cloud.Archive.SYNTHETIC.mkv",
      issues: ["Synthetic probe failed: subtitle streams and release identity could not be read."],
      identities: [],
    },
  ],
};

const refreshedInventory: SavedInventory = {
  ...initialInventory,
  scannedAt: "2026-02-16T08:30:00Z",
  errors: [],
};

export interface SavedVideoSelection {
  libraryId: string;
  id: string;
  label: string;
}

export interface SavedInventoryAdapter {
  search(query: string): SavedInventory;
  resolveIdentity(videoId: string, identityId: string): SavedVideoSelection | undefined;
  refresh(): Promise<InventoryRefreshResult>;
}

interface SyntheticSavedInventoryOptions {
  refresh?: () => Promise<InventoryRefreshAttempt>;
}

export function openSyntheticSavedInventory(
  options: SyntheticSavedInventoryOptions = {},
): SavedInventoryAdapter {
  let inventory = initialInventory;
  let lastRefreshFailure: InventoryRefreshFailure | undefined;
  const performRefresh = options.refresh ?? (async () => ({
    outcome: "success" as const,
    inventory: refreshedInventory,
  }));

  return {
    search(query) {
      const search = query.trim().toLowerCase();
      return {
        ...inventory,
        ...(lastRefreshFailure === undefined ? {} : { lastRefreshFailure }),
        videos: inventory.videos.filter((video) =>
          [video.file, ...video.identities.flatMap((identity) => [identity.title, identity.release])]
            .some((value) => value.toLowerCase().includes(search)),
        ),
      };
    },
    resolveIdentity(videoId, identityId) {
      const video = inventory.videos.find((item) => item.id === videoId);
      if (video === undefined || video.identities.length !== 1 || video.identities[0].id !== identityId) {
        return undefined;
      }
      return {
        libraryId: inventory.source,
        id: identityId,
        label: video.identities[0].title,
      };
    },
    async refresh() {
      const result = await performRefresh();
      if (result.outcome === "failed") {
        lastRefreshFailure = {
          error: result.error,
          retainedScannedAt: inventory.scannedAt,
        };
        return { outcome: result.outcome, ...lastRefreshFailure };
      }
      inventory = result.inventory;
      lastRefreshFailure = undefined;
      return result;
    },
  };
}
