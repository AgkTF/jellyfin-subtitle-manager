# Library Subtitles

Subtitles for a home Jellyfin library, with English as the first priority and Arabic as a required second language.

## Language

**Subtitle candidate**:
A subtitle considered for a particular video file, whose translation quality and timing suitability have not yet been established.

**Synchronization**:
Alignment of subtitle cue timings with the corresponding dialogue in a particular video file. Correct synchronization does not establish translation quality.

**Human-written Arabic subtitle**:
An Arabic subtitle authored or translated by a person, with Modern Standard Arabic preferred. Machine-generated alternatives are distinct fallbacks requiring explicit opt-in.

**Review-needed item**:
A video whose subtitle candidates lack sufficient evidence for automatic selection and need human review.

**Accepted subtitle**:
A subtitle approved for a particular video file through sufficient automated evidence or explicit human confirmation. Existing subtitles are initially unverified, not automatically accepted; verified embedded tracks can satisfy a language requirement.

**Embedded subtitle**:
A subtitle track contained within the video file rather than stored in a separate file.

**Text-based subtitle**:
A subtitle represented as text with cue timings, such as SRT. This is the preferred representation for new downloads.

**Image-based subtitle**:
A subtitle represented as timed images of words, such as DVD/VobSub or Blu-ray/PGS. It can satisfy a language requirement after its timing and playback suitability are verified.

**Unknown-provenance candidate**:
A subtitle candidate whose human or machine authorship has not been established. It may enter human review but cannot be automatically accepted as human-written.

**Rejected candidate**:
A subtitle candidate found unsuitable for a particular video file. It remains excluded from repeated consideration unless relevant evidence changes.

**Subtitle-complete title**:
A title with accepted full-dialogue subtitles for both English and Arabic for its video file. English-only availability does not make a title complete, and incompleteness does not prevent playback.

**Standard dialogue subtitle**:
A full-dialogue subtitle without the additional sound descriptions and speaker labels characteristic of SDH. This is the preferred English subtitle type.

**SDH subtitle**:
A subtitle for deaf and hard-of-hearing viewers that includes dialogue plus information such as sound descriptions and speaker labels. It is an acceptable English fallback.

**Forced-only subtitle**:
A subtitle covering selected dialogue or on-screen text rather than the full dialogue. It does not satisfy either required language on its own.
