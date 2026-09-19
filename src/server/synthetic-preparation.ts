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
}

export interface SyntheticPreparation {
  candidates: SubtitleCandidate[];
  recommendedCandidateId: string;
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
  const candidates = ["primary", "alternate", "conservative"].map((variant, index) => ({
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
  }));

  return { candidates, recommendedCandidateId: candidates[0].id };
}
