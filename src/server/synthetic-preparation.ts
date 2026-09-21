import { createHash } from "node:crypto";

import type { CandidatePreparation } from "./candidate-preparation.js";
import type { SubtitleLanguage, VideoIdentity } from "./request-workflow.js";

export type { PreparationOutcome, SubtitleCandidate } from "./candidate-preparation.js";

/**
 * Builds bounded fixture evidence only. This function deliberately has no
 * provider, filesystem, or network dependency.
 */
export function prepareSyntheticCandidates(
  video: VideoIdentity,
  language: SubtitleLanguage,
): CandidatePreparation {
  const languageName = language === "ar" ? "Arabic" : "English";
  const destination = `/synthetic/subtitles/${video.id}.${language}.srt`;
  const scenario = video.id.includes("no-suitable-candidate")
    ? { outcome: "no-suitable-candidate" as const, explanation: `No suitable ${languageName} subtitle candidate was found in this bounded run.`, nextActions: ["defer"] as Array<"defer" | "retry"> }
    : video.id.includes("blocked-preparation")
      ? { outcome: "blocked" as const, explanation: "Preparation is blocked because the saved subtitle evidence is ambiguous and requires an explicit identity or provider decision.", nextActions: ["defer", "retry"] as Array<"defer" | "retry"> }
      : video.id.includes("failed-preparation")
        ? { outcome: "failed" as const, explanation: "Candidate preparation failed before a usable result was produced. No candidate was downloaded.", nextActions: ["defer", "retry"] as Array<"defer" | "retry"> }
        : { outcome: "candidates-found" as const, explanation: `Prepared bounded ${languageName} candidates for review.`, nextActions: ["defer"] as Array<"defer" | "retry"> };
  const attachments: CandidatePreparation["attachments"] = [];
  const candidates = ["primary", "alternate", "conservative"].map((variant, index) => {
    const filename = `${video.id}.${language}.${variant}.srt`;
    const content = Buffer.from([
      "1",
      "00:00:01,000 --> 00:00:03,000",
      `Synthetic subtitle candidate ${index + 1} for ${video.label}.`,
      "",
      "2",
      "00:05:00,000 --> 00:05:02,000",
      `Synthetic ${languageName} middle sample for manual preview only.`,
      "",
      "3",
      "00:10:00,000 --> 00:10:02,000",
      "Synthetic subtitle ending sample.",
      "",
    ].join("\\n"), "utf8");
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
      completeness: {
        status: "unmeasured" as const,
        evidence: "No full-dialogue coverage measurement was performed.",
        limits: "Synthetic fixture structure does not establish full-dialogue coverage.",
      },
      destination: destination.replace(".srt", `-${variant}.srt`),
      recommendationReason: index === 0
        ? `Recommended as the clearest ${languageName} association among the synthetic fixtures; this is not a quality or synchronization measurement.`
        : "Available as an alternative for human review; no measured timing or authorship evidence is available.",
      contentHash: createHash("sha256").update(content).digest("hex"),
    };
    attachments.push({ candidateId: evidence.id, filename, content });
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
  const availableCandidateIds = new Set(availableCandidates.map((candidate) => candidate.id));
  return {
    ...scenario,
    candidates: availableCandidates,
    recommendedCandidateId: availableCandidates[0]?.id ?? null,
    attachments: attachments.filter((attachment) => availableCandidateIds.has(attachment.candidateId)),
  };
}
