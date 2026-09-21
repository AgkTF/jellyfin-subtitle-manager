import type { SubtitleLanguage, VideoIdentity } from "./request-workflow.js";

export type ProviderTitleIdentity =
  | { kind: "movie-imdb"; imdbId: string }
  | { kind: "movie-tmdb"; tmdbId: number }
  | { kind: "episode-imdb"; parentImdbId: string; season: number; episode: number }
  | { kind: "episode-tmdb"; parentTmdbId: number; season: number; episode: number };

export interface OpenSubtitlesMovieHashEvidence {
  algorithm: "opensubtitles-moviehash-v1";
  value: string;
  sourceByteLength: number;
  selectedFileEvidenceHash: string;
}

export interface OpenSubtitlesSearchIdentity {
  provider: "opensubtitles-v1";
  libraryId: string;
  videoId: string;
  savedIdentityId: string;
  selectedFileEvidenceHash: string;
  title: ProviderTitleIdentity;
  movieHash?: OpenSubtitlesMovieHashEvidence;
}

export interface PreparationVideo extends VideoIdentity {
  savedVideoId?: string;
  openSubtitlesSearchIdentity?: OpenSubtitlesSearchIdentity;
}

export interface SubtitleCandidate {
  id: string;
  label: string;
  file: string;
  release: string;
  association: string;
  language: SubtitleLanguage;
  subtitleType: "text-based";
  provenance: "unknown" | "provider-reported";
  authorship: "unknown";
  provider?: {
    name: "opensubtitles-v1";
    subtitleId: string;
    fileId: number;
  };
  timing: {
    status: "unmeasured";
    evidence: string;
    limits: string;
  };
  completeness: {
    status: "unmeasured";
    evidence: string;
    limits: string;
  };
  destination: string;
  recommendationReason: string;
  identityEvidenceHash: string;
  contentHash: string;
}

export type CandidateAttachmentMaterial =
  | { candidateId: string; filename: string; content: Buffer }
  | { candidateId: string; filename: string; stagedFileId: string };

export type PreparationOutcome = "candidates-found" | "no-suitable-candidate" | "blocked" | "failed";

export interface CandidatePreparation {
  outcome: PreparationOutcome;
  explanation: string;
  nextActions: Array<"defer" | "retry">;
  candidates: SubtitleCandidate[];
  recommendedCandidateId: string | null;
  attachments: CandidateAttachmentMaterial[];
}

export interface CandidatePreparationAdapter {
  prepare(video: PreparationVideo, language: SubtitleLanguage): CandidatePreparation;
}
