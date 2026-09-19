import { createHash } from "node:crypto";

import type { SubtitleLanguage, VideoIdentity } from "./request-workflow.js";

export interface SubtitleCandidate {
  id: string;
  label: string;
  file: string;
  release: string;
  association: string;
  language: SubtitleLanguage;
  subtitleType: "text-based";
  provenance: "unknown";
  authorship: "unknown";
  timing: {
    status: "unmeasured";
    evidence: string;
    limits: string;
  };
  destination: string;
  recommendationReason: string;
  identityEvidenceHash: string;
}

export type PreparationOutcome = "candidates-found" | "no-suitable-candidate" | "blocked" | "failed";

export interface SyntheticPreparation {
  outcome: PreparationOutcome;
  explanation: string;
  nextActions: Array<"defer" | "retry">;
  candidates: SubtitleCandidate[];
  recommendedCandidateId: string | null;
}

/**
 * Builds bounded fixture evidence only. This function deliberately has no
 * provider, filesystem, or network dependency.
 */
export function prepareSyntheticCandidates(
  video: VideoIdentity,
  language: SubtitleLanguage,
): SyntheticPreparation {
  const languageName = language === "ar" ? "Arabic" : "English";
  const destination = `/synthetic/subtitles/${video.id}.${language}.srt`;
  const scenario = video.id.includes("no-suitable-candidate")
    ? { outcome: "no-suitable-candidate" as const, explanation: `No suitable ${languageName} subtitle candidate was found in this bounded run.`, nextActions: ["defer"] as Array<"defer" | "retry"> }
    : video.id.includes("blocked-preparation")
      ? { outcome: "blocked" as const, explanation: "Preparation is blocked because the saved subtitle evidence is ambiguous and requires an explicit identity or provider decision.", nextActions: ["defer", "retry"] as Array<"defer" | "retry"> }
      : video.id.includes("failed-preparation")
        ? { outcome: "failed" as const, explanation: "Candidate preparation failed before a usable result was produced. No candidate was downloaded.", nextActions: ["defer", "retry"] as Array<"defer" | "retry"> }
        : { outcome: "candidates-found" as const, explanation: `Prepared bounded ${languageName} candidates for review.`, nextActions: ["defer"] as Array<"defer" | "retry"> };
  const candidates = ["primary", "alternate", "conservative"].map((variant, index) => {
    const evidence = {
      id: `${video.id}-${language}-${variant}`,
      label: `Synthetic candidate ${index + 1}`,
      file: destination.replace(".srt", `-${variant}.srt`),
      release: `${video.label} · synthetic ${variant}`,
      association: `Prepared for the selected file ${video.id}; file association is synthetic fixture evidence, not a provider match.`,
      language,
      subtitleType: "text-based" as const,
      provenance: "unknown" as const,
      authorship: "unknown" as const,
      timing: {
        status: "unmeasured" as const,
        evidence: "No dialogue synchronization measurement was performed.",
        limits: "Structural and provider-style checks must not be described as measured dialogue synchronization.",
      },
      destination: destination.replace(".srt", `-${variant}.srt`),
      recommendationReason: index === 0
        ? `Recommended as the clearest ${languageName} association among the synthetic fixtures; this is not a quality or synchronization measurement.`
        : "Available as an alternative for human review; no measured timing or authorship evidence is available.",
    };
    const identityEvidence = {
      libraryId: video.libraryId,
      videoId: video.id,
      candidateId: evidence.id,
      language,
      variant,
      file: evidence.file,
      destination: evidence.destination,
    };
    return {
      ...evidence,
      identityEvidenceHash: createHash("sha256").update(JSON.stringify(identityEvidence)).digest("hex"),
    };
  });

  const availableCandidates = scenario.outcome === "candidates-found" ? candidates : [];
  return {
    ...scenario,
    candidates: availableCandidates,
    recommendedCandidateId: availableCandidates[0]?.id ?? null,
  };
}
