// utils/groqClipper.js
//
// Cloudinary-only video clipper.
//
// Pipeline:
//   1. Ingest source into Cloudinary via remote fetch
//        (only direct video URLs — MP4 / WebM / MOV / HLS work;
//         YouTube, TikTok, Instagram do NOT and are rejected up front)
//   2. Ask Cloudinary for an audio-only MP3 rendition of the source
//   3. Send that MP3 to Groq Whisper for transcription
//   4. Ask Groq Llama to find the top N highlight windows
//   5. Build clip URLs via Cloudinary trim transformations
//   6. Return the clip URLs
//
// No yt-dlp. No ffmpeg. No local disk. Runs on any Node host —
// including Render's free tier.
//
// Requires:
//   • CLOUD_NAME, API_KEY, API_SECRET in .env (Cloudinary)
//   • GROQ_API_KEY in .env (Groq)

import { v2 as cloudinary } from "cloudinary";
import { groqJSON } from "./xamutAI.js";

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;
const AUDIO_FETCH_TIMEOUT_MS = 90 * 1000;
const WHISPER_TIMEOUT_MS = 3 * 60 * 1000;
const HIGHLIGHT_TIMEOUT_MS = 2 * 60 * 1000;

const MIN_CLIP_SECONDS = 5;
const MAX_CLIP_SECONDS = 90;

// ─────────────────────────────────────────────────────────────
// Small utils
// ─────────────────────────────────────────────────────────────
const log = (...args) => console.log("[clip]", ...args);

const withTimeout = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms
      );
    }),
  ]);
};

const toNumber = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const clamp01 = (v) => {
  const n = Number(v) || 0;
  return Math.min(Math.max(n, 0), 1);
};

// ─────────────────────────────────────────────────────────────
// Source URL validation
//
// Cloudinary's fetch pipeline can ingest ANY publicly reachable URL
// that returns a media stream. It CANNOT resolve social media watch
// pages (YouTube / TikTok / Instagram / Twitter) to a video stream —
// those need signature deciphering that Cloudinary doesn't do.
//
// So we reject those hosts up front with a clear error, and pass
// everything else through to Cloudinary. If Cloudinary can't reach
// a URL, the ingest step translates its opaque error into a friendly
// message.
// ─────────────────────────────────────────────────────────────
const BLOCKED_HOSTS_RE =
  /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com\/watch|twitter\.com\/.+\/status|x\.com\/.+\/status)/i;

export function isYouTubeUrl(url = "") {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

export function isFetchableVideoUrl(url = "") {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (BLOCKED_HOSTS_RE.test(url)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Step 1 — Ingest source into Cloudinary via remote fetch
// ─────────────────────────────────────────────────────────────
export async function ingestVideo({ url }) {
  if (!isFetchableVideoUrl(url)) {
    if (isYouTubeUrl(url)) {
      throw new Error(
        "YouTube links aren't supported on this deployment. Paste a direct link to a video file instead (MP4, WebM, MOV, or HLS)."
      );
    }
    throw new Error(
      "That URL can't be ingested. Make sure it points directly to a video file (MP4, WebM, MOV, or HLS) that's publicly accessible."
    );
  }

  log("Cloudinary fetch:", url.slice(0, 120));

  try {
    const result = await withTimeout(
      cloudinary.uploader.upload(url, {
        resource_type: "video",
        folder: "xamut/clips/sources",
        public_id: `src_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      }),
      FETCH_TIMEOUT_MS,
      "Cloudinary ingest"
    );

    if (!result?.public_id) {
      throw new Error("Cloudinary returned no public_id.");
    }

    log(`✅ ingested → ${result.public_id} (${result.duration || 0}s)`);

    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      duration: Number(result.duration) || 0,
      format: result.format || "mp4",
      width: result.width || 0,
      height: result.height || 0,
      title: "",
    };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/fetch|remote|404|400|unable|denied|not accessible|timed out/i.test(msg)) {
      throw new Error(
        "Cloudinary couldn't fetch that video. Make sure the URL is a direct link to a video file (MP4, WebM, MOV, or HLS) that's publicly accessible."
      );
    }
    throw new Error(`Cloudinary ingest failed: ${msg.slice(0, 300)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Step 2 — Fetch the audio-only MP3 rendition from Cloudinary
//
// Cloudinary can produce an audio-only rendition of any video asset
// on the fly. We hand the URL back and the caller streams it into
// Groq Whisper. The MP3 stays small (Cloudinary uses ~64kbps by
// default for mp3 audio extractions) so it fits Whisper's 25MB cap
// for videos up to ~40 minutes.
// ─────────────────────────────────────────────────────────────
export function buildAudioUrl(publicId) {
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "mp3",
    transformation: [{ audio_codec: "mp3" }],
    secure: true,
  });
}

async function fetchAudioBuffer(publicId) {
  const audioUrl = buildAudioUrl(publicId);
  log("fetching audio from Cloudinary…");

  const res = await withTimeout(
    fetch(audioUrl),
    AUDIO_FETCH_TIMEOUT_MS,
    "Cloudinary audio fetch"
  );

  if (!res.ok) {
    throw new Error(`Cloudinary audio fetch failed (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const sizeMB = buffer.length / (1024 * 1024);
  log(`audio ready: ${sizeMB.toFixed(2)} MB`);

  if (sizeMB > 25) {
    throw new Error(
      `Audio track is ${sizeMB.toFixed(
        1
      )}MB — Groq's Whisper caps at 25MB. Try a shorter video.`
    );
  }

  return buffer;
}

// ─────────────────────────────────────────────────────────────
// Step 3 — Transcribe with Groq Whisper
// ─────────────────────────────────────────────────────────────
async function transcribeAudio({ publicId }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set.");

  const buffer = await fetchAudioBuffer(publicId);

  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: "audio/mpeg" }),
    "audio.mp3"
  );
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("timestamp_granularities[]", "word");

  log("sending to Groq Whisper…");

  const res = await withTimeout(
    fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    }),
    WHISPER_TIMEOUT_MS,
    "Whisper"
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Whisper failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const segments = data.segments || [];
  log(`transcribed ${segments.length} segments`);

  return {
    text: data.text || "",
    segments,
    words: data.words || [],
    duration: data.duration || 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Step 4 — Find highlights with Groq Llama
// ─────────────────────────────────────────────────────────────
async function findHighlights({ segments, userPrompt, clipCount, videoDuration }) {
  if (!segments.length) {
    throw new Error("Transcript contains no segments.");
  }

  const transcript = segments
    .map((s) => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text.trim()}`)
    .join("\n");

  const estimatedTokens = Math.ceil(transcript.length / 4);
  const transcriptText =
    estimatedTokens > 60000
      ? sampleTranscript(segments, 60000).join("\n")
      : transcript;

  log(
    `transcript: ${transcript.length} chars (~${estimatedTokens} tokens)${
      estimatedTokens > 60000 ? " — SAMPLED" : ""
    }`
  );

  const duration =
    Number(videoDuration) ||
    Number(segments[segments.length - 1]?.end) ||
    Infinity;

  let raw;
  try {
    log("analyzing transcript with Llama…");
    raw = await withTimeout(
      groqJSON({
        messages: [
          {
            role: "system",
            content: `You analyze video transcripts to find the most viral-worthy moments.

You are looking for:
- Strong hooks ("here's the thing nobody tells you...")
- Surprising reveals or contrarian takes
- Emotional peaks (laughter, frustration, excitement)
- Self-contained stories with a clear setup and payoff
- Quotable one-liners

You are NOT looking for:
- Intros, outros, sponsor reads, or channel plugs
- Filler ("um", "you know", "anyway")
- Segments that only make sense with missing context

Each clip you return must be a complete thought that stands alone.
Duration target: 20 to 60 seconds per clip.

TIMESTAMPS ARE IN SECONDS. If you see [14:23-14:58] that means start = 863, end = 898. Do NOT return milliseconds, do NOT return minutes — always seconds as a plain number.

${userPrompt ? `The user specifically asked for: ${userPrompt}` : ""}

Return STRICT JSON only.`,
          },
          {
            role: "user",
            content: `Transcript with timestamps:

${transcriptText}

Return up to ${clipCount} clips, ranked from most to least viral. Fewer is fine if the transcript doesn't contain enough distinct moments.

JSON shape:
{
  "clips": [
    {
      "start": number (seconds),
      "end": number (seconds),
      "title": "short 3-6 word label",
      "hook": "the one-line hook that would make someone stop scrolling",
      "reason": "why this moment is engaging (one sentence)",
      "viralityScore": number between 0 and 1
    }
  ]
}
No markdown, no commentary.`,
          },
        ],
        temperature: 0.3,
        maxTokens: 2000,
      }),
      HIGHLIGHT_TIMEOUT_MS,
      "Llama highlight scan"
    );
  } catch (err) {
    log("Llama call failed:", err.message);
    const fallback = buildFallbackClips(segments, clipCount);
    if (!fallback.length) throw err;
    log(`⚠️ using fallback: ${fallback.length} evenly-spaced clips`);
    return fallback;
  }

  log("Llama raw response:", JSON.stringify(raw).slice(0, 900));

  const rawClips = Array.isArray(raw?.clips) ? raw.clips : [];
  log(`Llama returned ${rawClips.length} raw clip${rawClips.length === 1 ? "" : "s"}`);

  const normalized = [];

  for (const c of rawClips) {
    const start = toNumber(c.start);
    const end = toNumber(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    let s = Math.max(0, start);
    let e = Number.isFinite(duration) ? Math.min(end, duration) : end;

    // If Llama gave us milliseconds instead of seconds, scale down
    if (Number.isFinite(duration) && duration > 0 && e > duration * 1.5) {
      s = s / 1000;
      e = e / 1000;
    }

    if (e <= s) continue;

    // Clamp duration into the acceptable window instead of rejecting
    const dur = e - s;
    if (dur > MAX_CLIP_SECONDS) e = s + MAX_CLIP_SECONDS;
    if (dur < MIN_CLIP_SECONDS) {
      e = Math.min(s + MIN_CLIP_SECONDS, Number.isFinite(duration) ? duration : s + MIN_CLIP_SECONDS);
    }

    if (e - s < MIN_CLIP_SECONDS) continue;

    normalized.push({
      start: s,
      end: e,
      title: String(c.title || "").slice(0, 80),
      hook: String(c.hook || "").slice(0, 200),
      reason: String(c.reason || "").slice(0, 300),
      viralityScore: clamp01(c.viralityScore),
    });
  }

  if (normalized.length) {
    log(`✅ accepted ${normalized.length} clips`);
    return normalized.slice(0, clipCount);
  }

  log("⚠️ Llama response was unusable — falling back to evenly-spaced windows");
  const fallback = buildFallbackClips(segments, clipCount);
  if (!fallback.length) {
    throw new Error(
      "Couldn't find any usable segments in the transcript — try a longer video."
    );
  }
  log(`✅ fallback produced ${fallback.length} clips`);
  return fallback;
}

function buildFallbackClips(segments, count) {
  if (!segments.length) return [];
  const total = Number(segments[segments.length - 1]?.end) || 0;
  if (total <= 0) return [];

  const windowSize = Math.min(MAX_CLIP_SECONDS, total / count);
  const clips = [];

  for (let i = 0; i < count; i++) {
    const targetStart = (total / count) * i;

    // Snap to the nearest segment boundary
    let anchor = segments[0];
    let bestDelta = Math.abs(anchor.start - targetStart);
    for (const s of segments) {
      const d = Math.abs(s.start - targetStart);
      if (d < bestDelta) {
        anchor = s;
        bestDelta = d;
      }
    }

    const start = Math.max(0, anchor.start);
    const end = Math.min(start + windowSize, total);
    if (end - start < MIN_CLIP_SECONDS) continue;

    clips.push({
      start,
      end,
      title: `Segment ${i + 1}`,
      hook: "",
      reason: "Auto-selected segment",
      viralityScore: 0.3,
    });
  }
  return clips;
}

// ─────────────────────────────────────────────────────────────
// Step 5 — Build clip URLs via Cloudinary trim transformations
//
// Cloudinary trims videos on the fly using:
//   so_ (start_offset) — start time in seconds
//   eo_ (end_offset)   — end time in seconds
//
// We also apply the reframe in the same URL so the delivered MP4
// is already cropped for social (1080×1920) or standard (1280×720).
// ─────────────────────────────────────────────────────────────
export function buildClipUrl({ publicId, start, end, aspectRatio = "portrait" }) {
  const transformation = [
    { start_offset: String(start), end_offset: String(end) },
  ];

  if (aspectRatio === "portrait") {
    transformation.push({
      width: 1080,
      height: 1920,
      crop: "fill",
      gravity: "auto",
    });
  } else {
    transformation.push({
      width: 1280,
      height: 720,
      crop: "fill",
      gravity: "auto",
    });
  }

  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "mp4",
    transformation,
    secure: true,
  });
}

// ─────────────────────────────────────────────────────────────
// Full pipeline
// ─────────────────────────────────────────────────────────────
export async function processClipJob({
  url,
  userPrompt,
  clipCount = 7,
  aspectRatio = "portrait",
  onProgress,
}) {
  const report = async (stage) => {
    log(`stage → ${stage}`);
    if (typeof onProgress === "function") {
      try {
        await onProgress(stage);
      } catch {
        /* progress reporting must never kill the job */
      }
    }
  };

  if (!url) throw new Error("videoUrl is required");

  // 1. Ingest
  await report("downloading");
  const source = await ingestVideo({ url });

  // 2. Transcribe
  await report("transcribing");
  const { text, segments, duration } = await transcribeAudio({
    publicId: source.publicId,
  });
  if (!segments.length) {
    throw new Error("Transcription returned no segments.");
  }

  // 3. Find highlights
  await report("analyzing");
  const candidates = await findHighlights({
    segments,
    userPrompt,
    clipCount,
    videoDuration: source.duration || duration,
  });

  // 4. Build clip URLs
  await report("clipping");
  const clips = candidates.map((c) => ({
    url: buildClipUrl({
      publicId: source.publicId,
      start: c.start,
      end: c.end,
      aspectRatio,
    }),
    duration: Math.round(c.end - c.start),
    startTime: c.start,
    endTime: c.end,
    title: c.title,
    hook: c.hook,
    viralityScore: c.viralityScore,
    aspectRatio,
  }));

  return {
    title: source.title || "",
    duration: source.duration || duration,
    transcript: text,
    segments,
    clips,
    sourcePublicId: source.publicId,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sampleTranscript(segments, targetTokens) {
  const totalChars = segments.reduce((sum, s) => sum + s.text.length + 20, 0);
  const keepRatio = (targetTokens * 4) / totalChars;
  const step = Math.max(1, Math.round(1 / keepRatio));

  const picked = [];
  for (let i = 0; i < segments.length; i += step) {
    const s = segments[i];
    picked.push(`[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text.trim()}`);
  }
  return picked;
}