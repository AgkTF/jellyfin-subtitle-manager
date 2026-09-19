export interface SubtitleEvidence {
  status: "unverified" | "unknown";
  description: string;
}

export interface SavedVideoIdentity {
  id: string;
  title: string;
  release: string;
  association: string;
  english: SubtitleEvidence;
  arabic: SubtitleEvidence;
}

export interface SavedVideo {
  id: string;
  file: string;
  issues: string[];
  identities: SavedVideoIdentity[];
}

export interface InventoryRefreshFailure {
  error: string;
  retainedScannedAt: string;
}

export interface SavedInventory {
  source: "synthetic";
  scannedAt: string;
  errors: string[];
  videos: SavedVideo[];
  lastRefreshFailure?: InventoryRefreshFailure;
}

type CompletedInventoryRefresh = {
  outcome: "success" | "partial";
  inventory: SavedInventory;
};

export type InventoryRefreshAttempt =
  | CompletedInventoryRefresh
  | { outcome: "failed"; error: string };

export type InventoryRefreshResult =
  | CompletedInventoryRefresh
  | ({ outcome: "failed" } & InventoryRefreshFailure);
