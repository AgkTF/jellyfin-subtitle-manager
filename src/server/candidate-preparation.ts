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
    moviehashMatch?: boolean;
    hearingImpaired?: boolean;
    fromTrusted?: boolean;
    downloadCount?: number;
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

export type PreparationOutcome =
  | "candidates-found"
  | "no-candidates"
  | "no-suitable-candidate"
  | "blocked"
  | "authentication-failed"
  | "quota-exhausted"
  | "transport-failed"
  | "timed-out"
  | "malformed-provider-response"
  | "unsafe-content"
  | "provider-failed"
  | "duplicate-candidate"
  | "payload-budget-exhausted"
  | "run-deadline-exhausted"
  | "failed";

export interface CandidatePreparation {
  outcome: PreparationOutcome;
  explanation: string;
  nextActions: Array<"defer" | "retry">;
  candidates: SubtitleCandidate[];
  recommendedCandidateId: string | null;
  attachments: CandidateAttachmentMaterial[];
}

export interface CandidatePreparationRun {
  /** Durably spends an attempt before the matching provider download-link call. */
  reservePayloadAttempt(fileId: number): number | "duplicate" | "exhausted";
}

export interface CandidatePreparationAdapter {
  prepare(
    video: PreparationVideo,
    language: SubtitleLanguage,
    run?: CandidatePreparationRun,
  ): CandidatePreparation;
}
