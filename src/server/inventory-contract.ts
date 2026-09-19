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

export interface SavedInventory {
  source: "synthetic";
  scannedAt: string;
  errors: string[];
  videos: SavedVideo[];
}
