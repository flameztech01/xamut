// utils/groqClipper.js
//
// Groq video clipper — local-source version.
//
// Pipeline:
//   1. Download source to a temp file
//        • YouTube    → youtubei.js (multi-client retry)
//        • Direct URL → plain fetch
//   2. Extract a small mp3 from the temp file with ffmpeg
//   3. Send the mp3 to Groq Whisper
//   4. Ask Groq Llama for the top N highlight windows
//   5. Cut + reframe each clip locally with ffmpeg
//   6. Upload ONLY the final clips to Cloudinary
//   7. Delete every temp file
//
// Requires:
//   - GROQ_API_KEY in .env
//   - CLOUD_NAME / API_KEY / API_SECRET in .env
//   - ffmpeg-static installed
//   - youtubei.js installed

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { v2 as cloudinary } from "cloudinary";
import { Innertube } from "youtubei.js";
import ffmpegPath from "ffmpeg-static";

import { groqJSON } from "./xamutAI.js";

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

const YT_CLIENTS = ["ANDROID", "IOS", "TV", "MWEB", "WEB"];
const YT_QUALITIES = ["720p", "480p", "360p"];

const MIN_CLIP_SECONDS = 5;
const MAX_CLIP_SECONDS = 90;

// ─────────────────────────────────────────────────────────────
// Small utils
// ─────────────────────────────────────────────────────────────
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

const log = (...args) => console.log("[clip]", ...args);

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
// Source URL helpers
// ─────────────────────────────────────────────────────────────
const YOUTUBE_HOST_RE =
  /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;

export function isYouTubeUrl(url = "") {
  return YOUTUBE_HOST_RE.test(url);
}

export function extractYouTubeId(url = "") {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = re.exec(url);
    if (match) return match[1];
  }
  return null;
}

export function isDirectVideoUrl(url = "") {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (isYouTubeUrl(url)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// Temp file helpers
// ─────────────────────────────────────────────────────────────
async function createTempPath(prefix, ext = "mp4") {
  const filename = `xamut-${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}.${ext}`;
  return path.join(os.tmpdir(), filename);
}

async function safeDeleteFile(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err?.code !== "ENOENT") {
      log("cleanup warning:", err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ffmpeg runner
// ─────────────────────────────────────────────────────────────
function runFfmpeg(args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  if (!ffmpegPath) {
    return Promise.reject(
      new Error(
        "ffmpeg-static is not installed. Run: npm install ffmpeg-static"
      )
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new Error(`ffmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg spawn failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Stream → temp file
// ─────────────────────────────────────────────────────────────
async function downloadStreamToTempFile(webStream, filePath, timeoutMs) {
  if (!webStream) throw new Error("Source returned no download stream.");

  const nodeStream = Readable.fromWeb(webStream);

  await withTimeout(
    pipeline(nodeStream, createWriteStream(filePath)),
    timeoutMs,
    "stream → temp file"
  );

  const info = await stat(filePath);
  if (info.size === 0) throw new Error("Download produced an empty file.");
  return { sizeMB: info.size / (1024 * 1024), sizeBytes: info.size };
}

// ─────────────────────────────────────────────────────────────
// YouTube download
// ─────────────────────────────────────────────────────────────
async function downloadYouTube(videoId, destPath) {
  const errors = [];

  for (const clientType of YT_CLIENTS) {
    let yt;
    try {
      log(`Innertube.create(${clientType})…`);
      yt = await withTimeout(
        Innertube.create({ client_type: clientType, retrieve_player: true }),
        20000,
        `Innertube.create(${clientType})`
      );
    } catch (err) {
      errors.push(`${clientType}/init: ${err.message.slice(0, 100)}`);
      log(`${clientType} init failed:`, err.message);
      continue;
    }

    for (const quality of YT_QUALITIES) {
      const tag = `${clientType}/${quality}/mp4`;
      try {
        log(`trying ${tag}…`);

        const stream = await withTimeout(
          yt.download(videoId, {
            type: "video+audio",
            quality,
            format: "mp4",
          }),
          60000,
          `${tag} stream`
        );
        if (!stream) {
          errors.push(`${tag}: no stream`);
          continue;
        }

        log(`${tag} → writing to temp file…`);
        const { sizeMB } = await downloadStreamToTempFile(
          stream,
          destPath,
          DOWNLOAD_TIMEOUT_MS
        );

        log(`✅ downloaded ${tag} — ${sizeMB.toFixed(2)} MB`);
        return { client: clientType, quality, sizeMB };
      } catch (err) {
        errors.push(`${tag}: ${err.message.slice(0, 120)}`);
        log(`${tag} failed:`, err.message);
        await safeDeleteFile(destPath);
      }
    }
  }

  throw new Error(
    `YouTube download failed after all attempts. Last errors: ${errors
      .slice(-6)
      .join(" | ")}`
  );
}

// ─────────────────────────────────────────────────────────────
// Direct URL download
// ─────────────────────────────────────────────────────────────
async function downloadDirect(url, destPath) {
  log(`fetching ${url.slice(0, 120)}…`);
  const res = await withTimeout(fetch(url), 60000, "direct fetch");
  if (!res.ok) throw new Error(`Source returned HTTP ${res.status}`);
  if (!res.body) throw new Error("Source returned no body");

  const { sizeMB } = await downloadStreamToTempFile(
    res.body,
    destPath,
    DOWNLOAD_TIMEOUT_MS
  );
  log(`✅ downloaded — ${sizeMB.toFixed(2)} MB`);
  return { sizeMB };
}

// ─────────────────────────────────────────────────────────────
// Best-effort metadata
// ─────────────────────────────────────────────────────────────
async function fetchYouTubeMeta(videoId) {
  try {
    const yt = await withTimeout(
      Innertube.create(),
      15000,
      "Innertube.create (meta)"
    );
    const info = await withTimeout(
      yt.getBasicInfo(videoId),
      15000,
      "getBasicInfo"
    );
    return {
      title: info?.basic_info?.title || "",
      duration: info?.basic_info?.duration || 0,
      author: info?.basic_info?.author || "",
    };
  } catch (err) {
    log("meta fetch failed (non-fatal):", err.message);
    return { title: "", duration: 0, author: "" };
  }
}

// ─────────────────────────────────────────────────────────────
// Ingest → local temp path
// ─────────────────────────────────────────────────────────────
export async function ingestVideo({ url }) {
  const localPath = await createTempPath("src", "mp4");

  if (isYouTubeUrl(url)) {
    const videoId = extractYouTubeId(url);
    if (!videoId) {
      throw new Error("Couldn't extract a video ID from that YouTube URL.");
    }

    const metaPromise = fetchYouTubeMeta(videoId);
    await downloadYouTube(videoId, localPath);
    const meta = await metaPromise;

    return {
      localPath,
      title: meta.title || "",
      duration: meta.duration || 0,
    };
  }

  if (isDirectVideoUrl(url)) {
    await downloadDirect(url, localPath);
    return { localPath, title: "", duration: 0 };
  }

  throw new Error(
    "That URL isn't a YouTube link or a direct video file. Paste a YouTube URL or a direct link to a video file."
  );
}

// ─────────────────────────────────────────────────────────────
// Extract audio locally
// ─────────────────────────────────────────────────────────────
async function extractAudio(videoPath, audioPath) {
  log("extracting audio with ffmpeg…");
  await runFfmpeg([
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-c:a",
    "libmp3lame",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-b:a",
    "64k",
    audioPath,
  ]);

  const info = await stat(audioPath);
  const sizeMB = info.size / (1024 * 1024);
  log(`audio ready: ${sizeMB.toFixed(2)} MB`);
  return sizeMB;
}

// ─────────────────────────────────────────────────────────────
// Whisper transcription
// ─────────────────────────────────────────────────────────────
async function transcribeLocalAudio(audioPath) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set.");

  const buffer = await fs.readFile(audioPath);
  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error(
      `Audio is ${(buffer.length / 1024 / 1024).toFixed(
        1
      )}MB — Groq's Whisper caps at 25MB. Try a shorter video.`
    );
  }

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "audio.mp3");
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
    180000,
    "Whisper"
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Whisper failed (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  log(`transcribed ${data.segments?.length || 0} segments`);
  return {
    text: data.text || "",
    segments: data.segments || [],
    words: data.words || [],
    duration: data.duration || 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Fallback clip picker — used when Llama returns nothing usable
// ─────────────────────────────────────────────────────────────
function buildFallbackClips(segments, count, maxDuration) {
  if (!segments.length) return [];
  const total = Number(segments[segments.length - 1]?.end) || 0;
  if (total <= 0) return [];

  const windowSize = Math.min(maxDuration, total / count);
  const clips = [];

  for (let i = 0; i < count; i++) {
    const targetStart = (total / count) * i;

    // Snap to the nearest segment start
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
// Highlight detection — Groq Llama
// ─────────────────────────────────────────────────────────────
export async function findHighlights({
  segments,
  userPrompt,
  clipCount,
  videoDuration,
}) {
  const transcript = segments
    .map(
      (s) => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text.trim()}`
    )
    .join("\n");

  const estimatedTokens = Math.ceil(transcript.length / 4);
  const transcriptText =
    estimatedTokens > 60000
      ? sampleTranscript(segments, 60000).join("\n")
      : transcript;

  log(
    `transcript length: ${transcript.length} chars (~${estimatedTokens} tokens)${
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

TIMESTAMPS ARE IN SECONDS. If you see [14:23-14:58] that means 14 minutes 23 seconds, so start = 863 and end = 898. Do NOT return milliseconds, do NOT return minutes — always seconds as a plain number.

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
      120000,
      "Llama highlight scan"
    );
  } catch (err) {
    log("Llama call failed:", err.message);
    log("⚠️ falling back to evenly-spaced windows");
    const fallback = buildFallbackClips(segments, clipCount, MAX_CLIP_SECONDS);
    if (!fallback.length) throw new Error(err.message);
    return fallback;
  }

  // Log what we actually got so the terminal shows the raw response
  log("Llama raw response:", JSON.stringify(raw).slice(0, 900));

  const rawClips = Array.isArray(raw?.clips) ? raw.clips : [];
  log(`Llama returned ${rawClips.length} raw clip${rawClips.length === 1 ? "" : "s"}`);

  const normalized = [];

  for (const c of rawClips) {
    const start = toNumber(c.start);
    const end = toNumber(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      log(`  ✗ rejected (bad numbers): ${JSON.stringify(c).slice(0, 120)}`);
      continue;
    }

    let s = Math.max(0, start);
    let e = Math.min(end, duration);

    // If Llama gave us ms instead of seconds, scale down
    if (e > duration * 1.5 && duration > 0) {
      s = s / 1000;
      e = e / 1000;
    }

    if (e <= s) {
      log(`  ✗ rejected (end <= start): ${s} → ${e}`);
      continue;
    }

    // Clamp duration into the acceptable window instead of rejecting
    let dur = e - s;
    if (dur > MAX_CLIP_SECONDS) e = s + MAX_CLIP_SECONDS;
    if (dur < MIN_CLIP_SECONDS) e = Math.min(s + MIN_CLIP_SECONDS, duration);

    if (e - s < MIN_CLIP_SECONDS) {
      log(`  ✗ rejected (duration ${(e - s).toFixed(1)}s): ${s} → ${e}`);
      continue;
    }

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

  // Llama returned something but nothing survived normalization
  log("⚠️ Llama response was unusable — falling back to evenly-spaced windows");
  const fallback = buildFallbackClips(segments, clipCount, MAX_CLIP_SECONDS);
  if (!fallback.length) {
    throw new Error(
      "Couldn't find any usable segments in the transcript — try a longer video."
    );
  }
  log(`✅ fallback produced ${fallback.length} clips`);
  return fallback;
}

// ─────────────────────────────────────────────────────────────
// Cut one clip locally
// ─────────────────────────────────────────────────────────────
async function cutClipLocally({
  videoPath,
  outputPath,
  start,
  end,
  aspectRatio = "portrait",
}) {
  const duration = Math.max(0.5, end - start);

  const vf =
    aspectRatio === "portrait"
      ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
      : "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";

  await runFfmpeg([
    "-y",
    "-ss",
    String(start),
    "-i",
    videoPath,
    "-t",
    String(duration),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

// ─────────────────────────────────────────────────────────────
// Upload a finished clip
// ─────────────────────────────────────────────────────────────
async function uploadClip(localPath) {
  const res = await withTimeout(
    cloudinary.uploader.upload(localPath, {
      resource_type: "video",
      folder: "xamut/clips",
      public_id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    }),
    UPLOAD_TIMEOUT_MS,
    "Cloudinary clip upload"
  );
  return res.secure_url;
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

  const cleanup = [];

  try {
    // 1. Download
    await report("downloading");
    const source = await ingestVideo({ url });
    cleanup.push(source.localPath);
    log(`source ready: ${source.localPath}`);

    // 2. Extract audio
    await report("transcribing");
    const audioPath = await createTempPath("audio", "mp3");
    cleanup.push(audioPath);
    await extractAudio(source.localPath, audioPath);

    // 3. Transcribe
    const { text, segments, duration } = await transcribeLocalAudio(audioPath);
    if (!segments.length) {
      throw new Error("Transcription returned no segments.");
    }

    // 4. Find highlights
    await report("analyzing");
    const candidates = await findHighlights({
      segments,
      userPrompt,
      clipCount,
      videoDuration: duration || source.duration || 0,
    });

    // 5. Cut + upload each clip
    await report("clipping");
    const clips = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const clipPath = await createTempPath(`clip-${i}`, "mp4");
      cleanup.push(clipPath);

      try {
        log(
          `cutting clip ${i + 1}/${candidates.length} — ${c.start.toFixed(
            1
          )}s → ${c.end.toFixed(1)}s`
        );
        await cutClipLocally({
          videoPath: source.localPath,
          outputPath: clipPath,
          start: c.start,
          end: c.end,
          aspectRatio,
        });

        const cloudUrl = await uploadClip(clipPath);
        clips.push({
          url: cloudUrl,
          duration: Math.round(c.end - c.start),
          startTime: c.start,
          endTime: c.end,
          title: c.title,
          hook: c.hook,
          viralityScore: c.viralityScore,
          aspectRatio,
        });
      } catch (clipErr) {
        log(`clip ${i + 1} failed: ${clipErr.message}`);
      }
    }

    if (!clips.length) {
      throw new Error("No clips were produced — every ffmpeg cut failed.");
    }

    return {
      title: source.title || "",
      duration: source.duration || duration,
      transcript: text,
      segments,
      clips,
    };
  } finally {
    for (const f of cleanup) {
      await safeDeleteFile(f);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const formatTime = (secs) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function sampleTranscript(segments, targetTokens) {
  const totalChars = segments.reduce((sum, s) => sum + s.text.length + 20, 0);
  const keepRatio = (targetTokens * 4) / totalChars;
  const step = Math.max(1, Math.round(1 / keepRatio));

  const picked = [];
  for (let i = 0; i < segments.length; i += step) {
    const s = segments[i];
    picked.push(
      `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text.trim()}`
    );
  }
  return picked;
}