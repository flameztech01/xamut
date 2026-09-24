// utils/xamutAI.js
//
// Groq-backed AI service — key pool, size discipline, agent loop, and
// map-reduce split for big requests, all in one file.
//
// ── Multi-key pooling ─────────────────────────────────────────────
// Up to 3 API keys from 3 SEPARATE Groq accounts via GROQ_API_KEY_1
// /2/3. Falls back to legacy GROQ_API_KEY if those are absent.
//
// Groq enforces rate limits per-ORGANIZATION, so multiple keys inside
// ONE account share a single budget and multiply nothing. To actually
// triple your ceilings you need 3 distinct accounts.
//
// Selection: round-robin. On a short-term 429 we cool the specific
// key; on a daily 429 we park only the (key, model) pair, so other
// keys still serve the same model.
//
// ── Payload-size discipline ──────────────────────────────────────
// Free-tier TPM ceilings are small (gpt-oss-120b: 8K, qwen3.8-27b:
// 7K). A request larger than the ceiling is rejected by EVERY key
// identically — the pool cannot help with 413s. So this module:
//
//   1. Clamps systemPrompt and userContent to a fraction of the
//      model's TPM budget.
//   2. Trims the live message array (including tool results added
//      mid-loop) before every groqChat call, in whole units so we
//      never orphan a tool_call_id.
//   3. Caps tool results hard (2.5K chars).
//   4. On a 413, shrinks the input target and re-trims, rather than
//      retrying with the same oversized body.
//   5. Preflights in groqChat: refuses to even send if the payload
//      exceeds 92% of the model's TPM. Fail local, not remote.
//
// ── Split / map-reduce for big requests ──────────────────────────
// An LLM cannot be "sharded" mid-inference: you cannot send 1/3 of a
// prompt to key #1, 1/3 to key #2, 1/3 to key #3 and stitch tokens
// back. But INDEPENDENT work CAN be split:
//
//   • A long document chunked, each piece summarized in parallel,
//     then merged.
//   • Multiple entities researched at once ("compare X, Y, Z").
//   • Multiple sub-questions, if the caller knows they're independent.
//
// runSmartTurn() auto-detects the "big pasted document" case and
// routes to mapReduceDocument(). Small chat turns go through the
// normal agent loop. Nothing changes for normal conversation.
//
// ── Tool-choice note ─────────────────────────────────────────────
// GPT-OSS reaches for tools even when none are declared, and Groq
// rejects that with a 400 ("Tool choice is none, but model called a
// tool"). Fix: always declare tool_choice:"auto" for GPT-OSS, and
// pass disable_tool_validation so a hallucinated call doesn't blow
// up the request.

import {
  FORM_TYPE_IDS,
  CHOICE_FIELD_TYPES,
} from "../config/formCapabilities.js";

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_URL = `${GROQ_BASE}/chat/completions`;
const MODELS_URL = `${GROQ_BASE}/models`;

// ═════════════════════════════════════════════════════════════════════
// KEY POOL
// ═════════════════════════════════════════════════════════════════════

const readEnvKey = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const buildKeyPool = () => {
  const numbered = [
    readEnvKey("GROQ_API_KEY_1"),
    readEnvKey("GROQ_API_KEY_2"),
    readEnvKey("GROQ_API_KEY_3"),
  ].filter(Boolean);
  if (numbered.length) return numbered;
  const legacy = readEnvKey("GROQ_API_KEY");
  return legacy ? [legacy] : [];
};

let _keyPool = null;
const getKeyPool = () => {
  if (_keyPool === null) _keyPool = buildKeyPool();
  return _keyPool;
};

const _keyCooldown = new Map(); // idx -> resetAt (ms)
const _dailyExhausted = new Map(); // "idx::model" -> resetAt (ms)
let _rrCursor = 0;

const markKeyCooldown = (idx, retrySeconds) => {
  const seconds = Number(retrySeconds);
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
  _keyCooldown.set(idx, Date.now() + safe * 1000);
};

const markDailyExhausted = (idx, model, retryAfterSeconds) => {
  const seconds = Number(retryAfterSeconds);
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  _dailyExhausted.set(`${idx}::${model}`, Date.now() + safe * 1000);
};

const isKeyDailyExhausted = (idx, model) => {
  const k = `${idx}::${model}`;
  const resetAt = _dailyExhausted.get(k);
  if (!resetAt) return false;
  if (Date.now() >= resetAt) {
    _dailyExhausted.delete(k);
    return false;
  }
  return true;
};

const isKeyCooling = (idx, now = Date.now()) =>
  (_keyCooldown.get(idx) || 0) > now;

const isKeyHealthy = (idx, model, now = Date.now()) =>
  !isKeyCooling(idx, now) && !isKeyDailyExhausted(idx, model);

export const isDailyExhausted = (model) => {
  const pool = getKeyPool();
  if (pool.length === 0) return false;
  for (let i = 0; i < pool.length; i++) {
    if (!isKeyDailyExhausted(i, model)) return false;
  }
  return true;
};

const hasAvailableKeyForModel = (model) => {
  const pool = getKeyPool();
  const now = Date.now();
  for (let i = 0; i < pool.length; i++) {
    if (isKeyHealthy(i, model, now)) return true;
  }
  return false;
};

const pickKeyForModel = (model) => {
  const pool = getKeyPool();
  const total = pool.length;
  if (total === 0) return { idx: -1, reason: "no-keys" };

  const now = Date.now();

  for (let i = 0; i < total; i++) {
    const idx = (_rrCursor + i) % total;
    if (isKeyHealthy(idx, model, now)) {
      _rrCursor = (idx + 1) % total;
      return { idx };
    }
  }

  let fallbackIdx = -1;
  let fallbackCooldown = Infinity;
  for (let i = 0; i < total; i++) {
    const idx = (_rrCursor + i) % total;
    if (isKeyDailyExhausted(idx, model)) continue;
    const cd = _keyCooldown.get(idx) || 0;
    if (cd < fallbackCooldown) {
      fallbackCooldown = cd;
      fallbackIdx = idx;
    }
  }
  if (fallbackIdx !== -1) {
    _rrCursor = (fallbackIdx + 1) % total;
    return { idx: fallbackIdx };
  }

  return { idx: -1, reason: "daily-exhausted" };
};

export const getKeyPoolStatus = () => {
  const pool = getKeyPool();
  const now = Date.now();
  return {
    size: pool.length,
    cursor: _rrCursor,
    keys: pool.map((_, i) => ({
      index: i,
      coolingMsLeft: Math.max(0, (_keyCooldown.get(i) || 0) - now),
    })),
    dailyExhausted: Object.fromEntries(_dailyExhausted),
  };
};

// ═════════════════════════════════════════════════════════════════════
// MODEL POOLS
// ═════════════════════════════════════════════════════════════════════

const TEXT_CANDIDATES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "llama-3.3-70b-versatile",
];

const FAST_CANDIDATES = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.6-27b",
  "llama-3.3-70b-versatile",
];

const VISION_CANDIDATES = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "openai/gpt-oss-120b",
];

const HIGH_BUDGET_MODELS = ["groq/compound", "groq/compound-mini"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const supportsBuiltIns = (model = "") => /^openai\/gpt-oss/.test(model);
const isCompoundSystem = (model = "") => /^groq\/compound/.test(model);

const truncate = (s, n) =>
  s.length > n ? s.slice(0, Math.max(0, n - 1)) + "..." : s;

const emitStatus = (onStatus, text) => {
  if (typeof onStatus !== "function" || !text) return;
  try {
    onStatus(text);
  } catch {
    /* never let progress reporting kill the request */
  }
};

const dedupeByUrl = (list = []) => {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const url = item?.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(item);
  }
  return out;
};

const escapeRegex = (s) =>
  String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ═════════════════════════════════════════════════════════════════════
// TOKEN UTILITIES
// ═════════════════════════════════════════════════════════════════════

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => c.text || "").join(" ");
  return "";
};

export const estimateTokens = (input) => {
  if (typeof input === "string") return Math.ceil(input.length / 4) + 4;
  if (Array.isArray(input))
    return input.reduce((sum, m) => {
      if (m && typeof m === "object" && "content" in m)
        return sum + estimateTokens(textOf(m.content));
      return sum + estimateTokens(textOf(m));
    }, 0);
  if (input && typeof input === "object" && "content" in input)
    return estimateTokens(textOf(input.content));
  return 0;
};

const clampToTokens = (text, maxTokens) => {
  if (typeof text !== "string") return text;
  const maxChars = Math.max(200, Math.floor(maxTokens * 4));
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[…truncated for length]";
};

const trimHistoryToBudget = (history, fixedTokens, budget) => {
  const trimmed = [...history];
  while (trimmed.length > 0 && fixedTokens + estimateTokens(trimmed) > budget) {
    trimmed.shift();
  }
  return trimmed;
};

// Group a message list into units so that when we drop messages we
// never orphan a tool_call_id. A unit is either a single message or
// an (assistant-with-tool_calls + its following tool responses) cluster.
const groupIntoUnits = (msgs) => {
  const units = [];
  let k = 0;
  while (k < msgs.length) {
    const m = msgs[k];
    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length
    ) {
      const unit = [m];
      k++;
      while (k < msgs.length && msgs[k].role === "tool") {
        unit.push(msgs[k]);
        k++;
      }
      units.push(unit);
    } else {
      units.push([m]);
      k++;
    }
  }
  return units;
};

// Trim a LIVE message array. Preserves the system prompt (msgs[0])
// and the message equal by reference to `currentTurnRef`.
const trimLiveMessages = (msgs, inputBudget, currentTurnRef) => {
  if (msgs.length <= 2) return msgs;
  if (estimateTokens(msgs) <= inputBudget) return msgs;

  const head = msgs[0];
  const turnIdx = currentTurnRef ? msgs.indexOf(currentTurnRef) : -1;
  const safeTurnIdx = turnIdx >= 0 ? turnIdx : msgs.length - 1;

  const between = msgs.slice(1, safeTurnIdx);
  const after = msgs.slice(safeTurnIdx + 1);

  const betweenUnits = groupIntoUnits(between);
  const afterUnits = groupIntoUnits(after);

  const build = (keptBetweenUnits, keptAfterUnits) => [
    head,
    ...keptBetweenUnits.flat(),
    msgs[safeTurnIdx],
    ...keptAfterUnits.flat(),
  ];

  let keptBetween = [...betweenUnits];
  while (keptBetween.length > 0) {
    const candidate = build(keptBetween, afterUnits);
    if (estimateTokens(candidate) <= inputBudget) return candidate;
    keptBetween.shift();
  }

  let keptAfter = [...afterUnits];
  while (keptAfter.length > 0) {
    const candidate = build([], keptAfter);
    if (estimateTokens(candidate) <= inputBudget) return candidate;
    keptAfter.shift();
  }

  return [head, msgs[safeTurnIdx]];
};

// ═════════════════════════════════════════════════════════════════════
// FORM CONSTANTS
//
// Form types and choice field types come from config/formCapabilities.js.
// Do not hardcode either list here — add to the registry and it flows
// through to the tool schemas and executors on next boot.
// ═════════════════════════════════════════════════════════════════════

const FORM_TYPES = FORM_TYPE_IDS;
const CHOICE_TYPES = CHOICE_FIELD_TYPES;

const FORM_QUERY_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "on",
  "in",
  "to",
  "my",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "what",
  "whats",
  "what's",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
  "current",
  "latest",
  "recent",
  "stat",
  "stats",
  "statistic",
  "statistics",
  "status",
  "form",
  "forms",
  "quiz",
  "quizzes",
  "survey",
  "surveys",
  "feedback",
  "attendance",
  "application",
  "please",
  "show",
  "tell",
  "me",
  "about",
  "many",
  "much",
  "response",
  "responses",
  "submission",
  "submissions",
  "result",
  "results",
  "data",
  "info",
  "information",
  "get",
  "give",
  "list",
  "your",
  "you",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "with",
  "from",
  "i",
  "it",
  "can",
  "could",
  "would",
  "check",
  "look",
  "up",
]);

const extractFormKeywords = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FORM_QUERY_STOPWORDS.has(w));

const isDailyLimitError = (detail = "") => {
  if (typeof detail !== "string") return false;
  return (
    /tokens per day\s*\(TPD\)/i.test(detail) ||
    /on tokens per day/i.test(detail)
  );
};

// ═════════════════════════════════════════════════════════════════════
// PUBLIC IMAGE SOURCES
// ═════════════════════════════════════════════════════════════════════

export function publicImageSources(query) {
  const q = encodeURIComponent(String(query || "").trim());
  if (!q) return [];
  return [
    {
      name: "Wikimedia Commons",
      url: `https://commons.wikimedia.org/w/index.php?search=${q}`,
      note: "Free-licensed and public-domain photos.",
    },
    {
      name: "Wikipedia",
      url: `https://en.wikipedia.org/w/index.php?search=${q}`,
      note: "Encyclopedic article, usually with a portrait.",
    },
    {
      name: "Getty Images",
      url: `https://www.gettyimages.com/photos/${q}`,
      note: "Editorial and press photography.",
    },
    {
      name: "Google Images",
      url: `https://www.google.com/search?tbm=isch&q=${q}`,
      note: "Broad web image results.",
    },
    {
      name: "Bing Images",
      url: `https://www.bing.com/images/search?q=${q}`,
      note: "Broad web image results.",
    },
    {
      name: "IMDb",
      url: `https://www.imdb.com/find/?q=${q}`,
      note: "Headshots for actors and filmmakers.",
    },
  ];
}

// ═════════════════════════════════════════════════════════════════════
// TPM BUDGETS
// ═════════════════════════════════════════════════════════════════════

const DEFAULT_TPM = {
  "openai/gpt-oss-120b": 8000,
  "openai/gpt-oss-20b": 8000,
  "openai/gpt-oss-safeguard-20b": 8000,
  "qwen/qwen3.8-27b": 7000,
  "qwen/qwen3.6-27b": 7000,
  "groq/compound": 70000,
  "groq/compound-mini": 70000,
  "llama-3.3-70b-versatile": 8000,
};

const _learnedTpm = new Map();
const tpmFor = (model) => _learnedTpm.get(model) || DEFAULT_TPM[model] || 8000;

const learnTpm = (model, limit) => {
  if (!limit || !Number.isFinite(limit) || limit < 100) return;
  const existing = _learnedTpm.get(model);
  if (existing === undefined || limit < existing) {
    _learnedTpm.set(model, limit);
  }
};

// ═════════════════════════════════════════════════════════════════════
// MODEL DISCOVERY
// ═════════════════════════════════════════════════════════════════════

let _modelCache = null;
let _modelCachePromise = null;

export async function listAvailableModels({ force = false } = {}) {
  const pool = getKeyPool();
  if (pool.length === 0)
    throw new Error(
      "No Groq API key set. Add GROQ_API_KEY_1/2/3 (or GROQ_API_KEY) to your .env and restart the server.",
    );

  if (_modelCache && !force) return _modelCache;
  if (_modelCachePromise && !force) return _modelCachePromise;

  const now = Date.now();
  const keyIdx = pool.findIndex((_, i) => !isKeyCooling(i, now));
  const GROQ_KEY = pool[keyIdx === -1 ? 0 : keyIdx];

  _modelCachePromise = (async () => {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Could not list Groq models (${res.status}): ${body.slice(0, 300)}`,
      );
    }
    const data = await res.json();
    _modelCache = (data?.data || []).map((m) => m.id);
    console.log(`✅ Groq models available: ${_modelCache.join(", ")}`);
    return _modelCache;
  })();

  try {
    return await _modelCachePromise;
  } finally {
    _modelCachePromise = null;
  }
}

async function pickModel(candidates, envOverride) {
  const forced = envOverride && envOverride.trim();
  let available;
  try {
    available = await listAvailableModels();
  } catch (err) {
    console.warn("⚠️ Model discovery failed:", err.message);
    return forced || candidates[0];
  }

  if (forced) {
    if (available.includes(forced)) return forced;
    console.warn(`⚠️ "${forced}" not available, falling back.`);
  }

  const usable = available.filter((m) => !isDailyExhausted(m));
  const pool = usable.length ? usable : available;

  const match = candidates.find((c) => pool.includes(c));
  if (match) return match;

  const generic = pool.find(
    (m) =>
      !/whisper|guard|orpheus|tts|embed/i.test(m) &&
      !m.startsWith("groq/compound"),
  );
  if (generic) return generic;

  throw new Error(`No usable chat model. Available: ${available.join(", ")}`);
}

export const resolveTextModel = () =>
  pickModel(TEXT_CANDIDATES, process.env.GROQ_TEXT_MODEL);
export const resolveFastModel = () =>
  pickModel(FAST_CANDIDATES, process.env.GROQ_FAST_MODEL);
export const resolveVisionModel = () =>
  pickModel(VISION_CANDIDATES, process.env.GROQ_VISION_MODEL);
export const getTextModel = () =>
  process.env.GROQ_TEXT_MODEL || TEXT_CANDIDATES[0];
export const getFastModel = () =>
  process.env.GROQ_FAST_MODEL || FAST_CANDIDATES[0];
export const getVisionModel = () =>
  process.env.GROQ_VISION_MODEL || VISION_CANDIDATES[0];

// ═════════════════════════════════════════════════════════════════════
// ERROR PARSERS
// ═════════════════════════════════════════════════════════════════════

const parseLimitError = (detail = "") => {
  const limit = Number(/Limit (\d+)/i.exec(detail)?.[1]);
  const requested = Number(/Requested (\d+)/i.exec(detail)?.[1]);
  const retrySeconds = Number(
    /(?:try again in|retry.{0,3}after)\s*([\d.]+)\s*s/i.exec(detail)?.[1],
  );
  const namedModel = /model `([^`]+)`/i.exec(detail)?.[1] || null;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    requested: Number.isFinite(requested) ? requested : null,
    retrySeconds: Number.isFinite(retrySeconds) ? retrySeconds : null,
    namedModel,
  };
};

const isToolChoiceMismatchError = (detail = "") =>
  typeof detail === "string" &&
  /tool choice is none,? but model called a tool/i.test(detail);

const isJsonGenerationFailure = (detail = "") =>
  typeof detail === "string" && /Failed to generate JSON/i.test(detail);

// ═════════════════════════════════════════════════════════════════════
// CORE CALL
// ═════════════════════════════════════════════════════════════════════

export async function groqChat({
  messages,
  model,
  temperature = 0.7,
  maxTokens = 4096,
  jsonMode = false,
  tools,
  toolChoice,
  reasoningEffort,
}) {
  const pool = getKeyPool();
  if (pool.length === 0) {
    throw new Error(
      "No Groq API key set. Add GROQ_API_KEY_1/2/3 (or GROQ_API_KEY) to your .env and restart the server.",
    );
  }

  const chosenModel = model || (await resolveTextModel());
  const modelTpm = tpmFor(chosenModel);

  // Pre-flight: refuse to send a payload that every key would reject.
  const inputTokens = estimateTokens(messages);
  const hardCap = Math.floor(modelTpm * 0.92);
  if (inputTokens + maxTokens > hardCap) {
    const err = new Error(
      `Payload too large for "${chosenModel}": ~${inputTokens} input + ${maxTokens} output > ${hardCap} token cap (TPM ${modelTpm}). Trim before calling.`,
    );
    err.status = 413;
    err.model = chosenModel;
    err.isLocalOversize = true;
    err.detail = `local-payload-check: ${inputTokens}+${maxTokens} > ${hardCap}`;
    throw err;
  }

  const { idx: keyIdx, reason } = pickKeyForModel(chosenModel);
  if (keyIdx === -1) {
    const err = new Error(
      `Groq daily token budget for "${chosenModel}" is exhausted on all ${pool.length} key(s). Try again later.`,
    );
    err.status = 429;
    err.model = chosenModel;
    err.isDailyLimit = true;
    err.detail = "tokens per day (TPD) exhausted on all keys";
    err.poolSize = pool.length;
    err.reason = reason;
    throw err;
  }

  const GROQ_KEY = pool[keyIdx];

  const body = {
    model: chosenModel,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
  };

  if (jsonMode) body.response_format = { type: "json_object" };

  const hasTools = Array.isArray(tools) && tools.length > 0;
  const isBuiltInToolModel = supportsBuiltIns(chosenModel);

  if (hasTools) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
  } else if (isBuiltInToolModel) {
    body.tools = [];
    body.tool_choice = "auto";
    body.disable_tool_validation = true;
  }

  if (/gpt-oss|qwen/i.test(chosenModel)) {
    body.reasoning_format = "hidden";
    body.reasoning_effort = reasoningEffort || (jsonMode ? "low" : undefined);
  }

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(`Could not reach Groq: ${netErr.message}`);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let parsedBody = null;
    let detail = raw;
    try {
      parsedBody = JSON.parse(raw);
      detail = parsedBody?.error?.message || raw;
    } catch {}

    if (res.status === 404) _modelCache = null;

    const daily = isDailyLimitError(detail);
    const toolMismatch = isToolChoiceMismatchError(detail);
    const jsonFail = isJsonGenerationFailure(detail);

    if (res.status === 429) {
      const { retrySeconds, namedModel } = parseLimitError(detail);
      if (daily) {
        markDailyExhausted(
          keyIdx,
          namedModel || chosenModel,
          retrySeconds || 60,
        );
      } else {
        markKeyCooldown(keyIdx, retrySeconds || 30);
      }
    }

    if ((res.status === 413 || res.status === 429) && !daily) {
      const { limit, namedModel } = parseLimitError(detail);
      if (!namedModel || namedModel === chosenModel) {
        learnTpm(chosenModel, limit);
      }
    }

    const err = new Error(
      `Groq ${res.status} on "${chosenModel}" [key #${keyIdx + 1}]: ${
        detail?.slice ? detail.slice(0, 500) : detail || res.statusText
      }`,
    );
    err.status = res.status;
    err.model = chosenModel;
    err.keyIndex = keyIdx;
    err.poolSize = pool.length;
    err.detail = detail || "";
    err.isDailyLimit = daily;
    err.isToolChoiceMismatch = toolMismatch;
    err.isJsonGenerationFailure = jsonFail;
    err.failedGeneration = parsedBody?.error?.failed_generation || null;
    throw err;
  }

  return res.json();
}

const messageText = (msg) => (msg?.content || "").trim();

export async function groqText(args) {
  const data = await groqChat(args);
  return messageText(data?.choices?.[0]?.message);
}

export async function groqTextFast(args) {
  const model = args.model || (await resolveFastModel());
  return groqText({ ...args, model });
}

// ═════════════════════════════════════════════════════════════════════
// JSON CALLS
// ═════════════════════════════════════════════════════════════════════

const MAX_JSON_INPUT_TOKENS = 3500;

const clampMessagesForJson = (msgs) => {
  const total = estimateTokens(msgs);
  if (total <= MAX_JSON_INPUT_TOKENS) return msgs;

  const nonSystem = msgs.filter((m) => m.role !== "system");
  const share = Math.max(
    300,
    Math.floor(MAX_JSON_INPUT_TOKENS / Math.max(1, nonSystem.length)),
  );

  console.warn(
    `⚠️ JSON call input was ~${total} tokens (cap ${MAX_JSON_INPUT_TOKENS}). Clamping each non-system message to ~${share} tokens.`,
  );

  return msgs.map((m) => {
    if (m.role === "system") return m;
    if (typeof m.content !== "string") return m;
    return { ...m, content: clampToTokens(m.content, share) };
  });
};

const extractJson = (raw) => {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start)
      return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Model did not return valid JSON.");
  }
};

export async function groqJSON(args) {
  const safeMessages = clampMessagesForJson(args.messages);

  const attempt = async (messages, overrides = {}) =>
    extractJson(
      await groqText({
        ...args,
        ...overrides,
        messages,
        jsonMode: true,
        tools: undefined,
      }),
    );

  try {
    return await attempt(safeMessages);
  } catch (err) {
    const isValidationFailure =
      err.status === 400 && /validate json/i.test(err.detail || "");
    const isParseFailure = !err.status;
    const recoverable =
      err.isToolChoiceMismatch ||
      err.isJsonGenerationFailure ||
      isValidationFailure ||
      isParseFailure;

    if (!recoverable) throw err;

    const retryMessages = [
      ...safeMessages,
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Reply again with ONLY a single valid JSON object, nothing before or after it, no markdown fences, no explanation. Keep it as short as possible while still matching the required shape.",
      },
    ];

    return await attempt(clampMessagesForJson(retryMessages), {
      maxTokens: Math.max(args.maxTokens || 0, 800),
      temperature: Math.min(args.temperature ?? 0.6, 0.3),
    });
  }
}

export async function groqJSONFast(args) {
  const model = args.model || (await resolveFastModel());
  return groqJSON({ ...args, model });
}

// ═════════════════════════════════════════════════════════════════════
// TOOLS
//
// The `type` enum on list_user_forms reads from FORM_TYPE_IDS, so a
// new form type added to config/formCapabilities.js is instantly
// callable by the model — no edit needed here.
// ═════════════════════════════════════════════════════════════════════

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current information about anything: people, brands, businesses, products, creators, events, prices, tools, code, whatever. Use this whenever you're not 100% sure of the answer or the name is unfamiliar. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "image_search",
      description:
        "Search the web for pictures of a person, place, or thing. Use whenever the user asks to see a photo, a face, a place, or a product. Returns direct image URLs plus the public source pages the images came from and a list of public archives (Wikimedia Commons, Wikipedia, Getty, Google Images, IMDb) that host more photos of the same subject. Never claim you cannot find or show images, always call this instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to find images of, e.g. 'Cristiano Ronaldo'.",
          },
          count: {
            type: "number",
            description: "How many images to return. Defaults to 6, max 8.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_website",
      description:
        "Fetch a public website by URL and return its readable text content.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deep_search",
      description:
        "Run 3 to 5 web searches at once on different angles of the same topic. Use for comparisons, deep dives, or anything one query can't cover. Returns merged results.",
      parameters: {
        type: "object",
        properties: { queries: { type: "array", items: { type: "string" } } },
        required: ["queries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_person",
      description:
        "Look up anyone or anything with a public web presence: celebrities, athletes, founders, politicians, creators, developers, designers, freelancers, studios, agencies, indie brands, personal portfolios, small businesses, YouTubers, TikTokers, musicians. Does NOT have to be a celebrity. If they have a website, social account, portfolio, GitHub, Dribbble, LinkedIn, or any public footprint, this tool can find them. Returns bio, career, socials, news, quotes, public family info, and image results. Use this any time the user asks who someone is, what a brand is, or wants info about a name you don't recognise.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The person, brand, or business name.",
          },
          context: {
            type: "string",
            description:
              "Optional context like 'frontend developer' or 'Nigerian musician' or 'tech agency'.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_user_forms",
      description:
        "List the current user's own forms. Use this ANY time the user asks about their own forms: 'my forms', 'my quiz', 'my attendance form', 'my election', 'the survey I made', 'how many forms have I made', 'do I have a feedback form', 'list my surveys', 'show me my forms'. Supports fuzzy title matching and type filtering. Returns an array of forms with id, title, type, status, response count, and field count. If the user's reference is ambiguous (they have three attendance forms), this returns ALL matches so you can ask which one they mean. NEVER web search for the user's own forms — this is the tool for that.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Fuzzy text to match against form titles, or a type name like 'attendance' or 'election'. Omit to list every form the user has access to.",
          },
          type: {
            type: "string",
            enum: FORM_TYPE_IDS,
            description: "Optional form type filter.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form_stats",
      description:
        "Get detailed stats on ONE specific form the user owns: total responses, average completion time, per-field answer breakdowns, quiz scores, pass rate, election vote counts per candidate and position, response rate for private forms. Use this after list_user_forms, when the user's question is about a specific form: 'stats on my attendance form', 'how many responses', 'average score on my quiz', 'pass rate', 'leaderboard', 'who is winning the election', 'how many votes did X get', 'how did people answer question 3'. Requires a formId from list_user_forms.",
      parameters: {
        type: "object",
        properties: {
          formId: {
            type: "string",
            description: "The form _id returned by list_user_forms.",
          },
        },
        required: ["formId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form_responses",
      description:
        "List recent submissions to one of the user's forms, with each respondent's answers. Use for 'show me the responses', 'who filled it out', 'recent submissions', 'list the answers', 'what did people say', 'who voted for who'. Requires a formId from list_user_forms.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string" },
          limit: {
            type: "number",
            description:
              "How many recent responses to return. Defaults to 20, max 100.",
          },
        },
        required: ["formId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form_details",
      description:
        "Fetch the full definition of a form the user owns: title, description, type, visibility, every field with its options/validation/scoring, and — for elections — every position with its candidates. Use for 'what's on my form', 'show me the questions', 'list the fields', 'what does my quiz ask', 'who are the candidates in my election', 'what positions are being voted on'. Requires a formId from list_user_forms.",
      parameters: {
        type: "object",
        properties: { formId: { type: "string" } },
        required: ["formId"],
      },
    },
  },
];

const LOCAL_TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

const builtInTools = (model) => {
  if (!supportsBuiltIns(model)) return [];
  const list = [{ type: "browser_search" }];
  if (process.env.GROQ_ENABLE_CODE_EXEC === "true")
    list.push({ type: "code_interpreter" });
  return list;
};

export const toolsFor = (model) => {
  if (isCompoundSystem(model)) return [];
  return [...builtInTools(model), ...TOOLS];
};

// ═════════════════════════════════════════════════════════════════════
// TOOL EXECUTORS
// ═════════════════════════════════════════════════════════════════════

export async function webSearch(query, maxResults = 5) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: "basic",
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Web search failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    answer: data.answer || "",
    results: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    })),
  };
}

export async function imageSearch(query, count = 6) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY is not set.");

  const limit = Math.max(1, Math.min(Number(count) || 6, 8));

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      max_results: 6,
      include_images: true,
      include_image_descriptions: true,
      search_depth: "basic",
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(
      `Image search failed (${res.status}): ${err.slice(0, 200)}`,
    );
  }
  const data = await res.json();

  const raw = data.images || [];
  const images = raw
    .map((img) =>
      typeof img === "string"
        ? { url: img, description: "" }
        : { url: img.url || img, description: img.description || "" },
    )
    .filter((img) => img.url)
    .slice(0, limit);

  const sources = (data.results || []).slice(0, 6).map((r) => ({
    title: r.title,
    url: r.url,
  }));

  return {
    query,
    images,
    sources,
    whereToFind: publicImageSources(query),
  };
}

export async function fetchWebsite(url) {
  if (!/^https?:\/\//i.test(url))
    throw new Error("URL must start with http(s).");

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; XamutBot/1.0; +https://xamut.com/bot)",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, 8000);
}

export async function deepSearch(queries) {
  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error("deep_search requires a non-empty queries array.");
  }

  const capped = queries
    .filter((q) => typeof q === "string" && q.trim())
    .slice(0, 5);

  const results = await Promise.all(
    capped.map((q) =>
      webSearch(q.trim(), 4).catch(() => ({ answer: "", results: [] })),
    ),
  );

  const seen = new Set();
  const merged = [];
  for (let i = 0; i < results.length; i++) {
    for (const item of results[i].results || []) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push({ ...item, fromQuery: capped[i] });
      if (merged.length >= 12) break;
    }
    if (merged.length >= 12) break;
  }

  return {
    queries: capped,
    answers: results
      .map((r) => r.answer)
      .filter(Boolean)
      .slice(0, 3),
    sources: merged,
  };
}

export async function researchPerson(name, context = "") {
  if (!name || typeof name !== "string") {
    throw new Error("research_person requires a name.");
  }

  const base = context ? `${name} ${context}` : name;

  const queries = [
    `${base} who is`,
    `${base} biography about`,
    `${base} website portfolio`,
    `${base} instagram twitter linkedin`,
    `${base} news`,
    `${base} github dribbble behance`,
  ];

  const [textResults, imageResults] = await Promise.all([
    Promise.all(
      queries.map((q) =>
        webSearch(q, 3).catch(() => ({ answer: "", results: [] })),
      ),
    ),
    imageSearch(base, 4).catch(() => ({
      images: [],
      sources: [],
      whereToFind: [],
    })),
  ]);

  const seen = new Set();
  const merged = [];
  for (const r of textResults) {
    for (const item of r.results || []) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= 12) break;
    }
    if (merged.length >= 12) break;
  }

  return {
    name,
    context: context || null,
    answer: textResults
      .map((r) => r.answer)
      .filter(Boolean)
      .join(" ")
      .slice(0, 1200),
    sources: merged,
    images: imageResults.images || [],
    imageSources: imageResults.sources || [],
    whereToFind: imageResults.whereToFind?.length
      ? imageResults.whereToFind
      : publicImageSources(base),
  };
}

// ── Form executors ────────────────────────────────────────────────
let _formModelsPromise = null;
const loadFormModels = () => {
  if (!_formModelsPromise) {
    _formModelsPromise = Promise.all([
      import("../models/formModel.js"),
      import("../models/formResponseModel.js"),
    ]).then(([formMod, respMod]) => ({
      Form: formMod.default,
      FormResponse: respMod.default,
    }));
  }
  return _formModelsPromise;
};

const assertFormAccess = (form, userId) => {
  const uid = String(userId);
  if (String(form.owner) === uid) return "owner";
  const collab = (form.collaborators || []).find((c) => String(c.user) === uid);
  if (collab) return collab.role || "collaborator";
  throw new Error("You don't have access to that form.");
};

// Read a single position's vote out of a response document. The
// response schema may store election votes in one of a few places;
// try them in order and return the first that hits.
const extractPositionVote = (response, positionId) => {
  // Shape A: response.votes is an array of { positionId, candidateIds }
  if (Array.isArray(response?.votes)) {
    const v = response.votes.find(
      (x) => String(x.positionId) === String(positionId),
    );
    if (v) return v.candidateIds || v.value || v.candidateId || null;
  }
  // Shape B: response.votes is an object keyed by positionId
  if (response?.votes && typeof response.votes === "object") {
    const v = response.votes[String(positionId)];
    if (v != null) return v;
  }
  // Shape C: votes ride along in answers[] with fieldId === position.id
  const answer = (response?.answers || []).find(
    (a) => String(a.fieldId) === String(positionId),
  );
  if (answer) return answer.value;
  return null;
};

// Turn a form + its responses into per-position vote tallies.
const summarizeElectionPositions = (form, responses) => {
  const positions = form.positions || [];
  if (!positions.length) return [];

  return positions.slice(0, 20).map((p) => {
    const counts = new Map();
    for (const c of p.candidates || []) counts.set(String(c.id), 0);

    for (const r of responses) {
      const value = extractPositionVote(r, p.id);
      if (value == null) continue;
      const arr = Array.isArray(value) ? value : [value];
      for (const v of arr) {
        const k = String(v);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }

    const totalVotes = [...counts.values()].reduce((a, b) => a + b, 0);

    const candidates = (p.candidates || [])
      .map((c) => {
        const votes = counts.get(String(c.id)) || 0;
        return {
          id: c.id,
          name: c.name || "(unnamed candidate)",
          slogan: c.slogan || "",
          votes,
          percentage: totalVotes
            ? Number(((votes / totalVotes) * 100).toFixed(1))
            : 0,
        };
      })
      .sort((a, b) => b.votes - a.votes);

    const leaders = candidates.filter(
      (c) => c.votes === (candidates[0]?.votes || 0),
    );

    return {
      id: p.id,
      title: p.title || "(untitled position)",
      description: p.description || "",
      maxSelections: p.maxSelections || 1,
      required: p.required !== false,
      totalVotes,
      winner:
        candidates.length && candidates[0].votes > 0
          ? leaders.length > 1
            ? `tie: ${leaders.map((c) => c.name).join(" / ")}`
            : candidates[0].name
          : null,
      candidates,
    };
  });
};

async function listUserForms({ query, type } = {}, userId) {
  if (!userId) throw new Error("No user context for form lookup.");
  const { Form } = await loadFormModels();

  const and = [{ $or: [{ owner: userId }, { "collaborators.user": userId }] }];
  if (type && FORM_TYPES.includes(type)) and.push({ type });

  const trimmed = String(query || "").trim();
  const keywords = extractFormKeywords(trimmed);

  if (trimmed) {
    const ors = [];
    if (keywords.length) {
      for (const kw of keywords) {
        ors.push({ title: { $regex: escapeRegex(kw), $options: "i" } });
      }
    } else {
      ors.push({ title: { $regex: escapeRegex(trimmed), $options: "i" } });
    }

    const lower = trimmed.toLowerCase();
    const typeMatches = FORM_TYPES.filter(
      (t) => lower.includes(t) || t.includes(lower),
    );
    if (typeMatches.length) ors.push({ type: { $in: typeMatches } });

    and.push({ $or: ors });
  }

  let forms = await Form.find({ $and: and })
    .select(
      "owner title type status visibility responseCount fields positions collaborators createdAt updatedAt",
    )
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  if (trimmed && keywords.length && forms.length > 1) {
    const lowerTrimmed = trimmed.toLowerCase();
    forms = forms
      .map((f) => {
        const titleLower = (f.title || "").toLowerCase();
        let score = 0;
        for (const kw of keywords) if (titleLower.includes(kw)) score++;
        if (titleLower.includes(lowerTrimmed)) score += 5;
        return { f, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((s) => s.f);
  }

  const uid = String(userId);

  return {
    count: forms.length,
    ambiguous: forms.length > 1,
    filter: { query: trimmed || null, type: type || null },
    forms: forms.map((f) => {
      const isElection = f.type === "election";
      const itemCount = isElection
        ? (f.positions || []).length
        : (f.fields || []).filter((x) => x.type !== "section").length;
      return {
        id: String(f._id),
        title: f.title,
        type: f.type,
        status: f.status,
        visibility: f.visibility,
        responseCount: f.responseCount || 0,
        fieldCount: (f.fields || []).filter((x) => x.type !== "section").length,
        positionCount: (f.positions || []).length,
        itemCount,
        itemNoun: isElection ? "position" : "question",
        owned: String(f.owner) === uid,
        updatedAt: f.updatedAt,
      };
    }),
    hint:
      forms.length === 0
        ? "No forms matched. Offer to list all the user's forms instead."
        : forms.length === 1
          ? "Exactly one match. Use this form's id for follow-up tool calls."
          : "Multiple matches. Ask the user which one they mean before calling any form-specific tool. Show the titles.",
  };
}

async function getFormStatsTool({ formId } = {}, userId) {
  if (!formId) throw new Error("formId is required.");
  const { Form, FormResponse } = await loadFormModels();

  const form = await Form.findById(formId).lean();
  if (!form) throw new Error("Form not found.");
  assertFormAccess(form, userId);

  const responses = await FormResponse.find({ form: form._id })
    .limit(500)
    .lean();
  const total = responses.length;

  const durations = responses
    .map((r) => r.durationSeconds || 0)
    .filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const isElection = form.type === "election";

  // ── Election path ────────────────────────────────────────────
  const positions = isElection
    ? summarizeElectionPositions(form, responses)
    : [];

  // ── Non-election path ────────────────────────────────────────
  const isQuiz =
    !isElection &&
    (form.type === "quiz" ||
      (form.fields || []).some((f) => (f.scoring?.points || 0) > 0));

  const maxScore = isQuiz
    ? (form.fields || []).reduce(
        (sum, f) => sum + (f.scoring?.points || 0),
        0,
      )
    : 0;

  const scores = responses.map((r) => r.totalScore || 0);
  const percentages = responses.map((r) => r.percentage || 0);
  const avgScore = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const avgPct = percentages.length
    ? percentages.reduce((a, b) => a + b, 0) / percentages.length
    : 0;
  const passedCount = responses.filter((r) => r.passed === true).length;

  const fields = isElection
    ? []
    : (form.fields || [])
        .filter((f) => f.type !== "section")
        .slice(0, 40)
        .map((f) => {
          const values = responses
            .map((r) => (r.answers || []).find((a) => a.fieldId === f.id))
            .filter((a) => a && a.value !== null && a.value !== undefined);

          const base = {
            id: f.id,
            label: f.label,
            type: f.type,
            answered: values.length,
            skipped: total - values.length,
          };

          if (CHOICE_TYPES.has(f.type)) {
            const counts = {};
            for (const o of f.options || []) counts[o.value] = 0;
            for (const a of values) {
              const arr = Array.isArray(a.value) ? a.value : [a.value];
              for (const v of arr)
                counts[String(v)] = (counts[String(v)] || 0) + 1;
            }
            base.options = (f.options || []).slice(0, 20).map((o) => ({
              label: o.label,
              value: o.value,
              count: counts[o.value] || 0,
            }));
            base.mostChosen =
              base.options.slice().sort((a, b) => b.count - a.count)[0]
                ?.label || null;
          } else if (["number", "rating", "scale"].includes(f.type)) {
            const nums = values
              .map((a) => Number(a.value))
              .filter(Number.isFinite);
            if (nums.length) {
              base.min = Math.min(...nums);
              base.max = Math.max(...nums);
              base.avg = Number(
                (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2),
              );
            }
          } else if (f.type === "yes_no") {
            let yes = 0;
            let no = 0;
            for (const a of values) {
              if (a.value === true) yes++;
              else if (a.value === false) no++;
            }
            base.yes = yes;
            base.no = no;
          } else {
            base.samples = values
              .slice(-5)
              .reverse()
              .map((a) => String(a.value).slice(0, 120));
          }
          return base;
        });

  const responseRate =
    form.visibility === "private" && (form.participants || []).length
      ? (() => {
          const invited = form.participants.length;
          const submitted = form.participants.filter((p) => p.completed).length;
          return {
            invited,
            submitted,
            percentage: Math.round((submitted / invited) * 100),
          };
        })()
      : null;

  const electionSummary = isElection
    ? {
        positionCount: positions.length,
        totalVotesCast: positions.reduce((sum, p) => sum + p.totalVotes, 0),
        turnoutPerPosition: positions.map((p) => ({
          position: p.title,
          votes: p.totalVotes,
        })),
      }
    : null;

  return {
    formId: String(form._id),
    title: form.title,
    type: form.type,
    status: form.status,
    visibility: form.visibility,
    slug: form.slug,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    totalResponses: total,
    averageDurationSeconds: avgDuration,
    isElection,
    isQuiz,
    quiz: isQuiz
      ? {
          maxScore,
          averageScore: Number(avgScore.toFixed(2)),
          averagePercentage: Number(avgPct.toFixed(2)),
          passedCount,
          passPercentage: form.settings?.passPercentage || 0,
        }
      : null,
    election: electionSummary,
    positions,
    fields,
    responseRate,
  };
}

async function getFormResponsesTool({ formId, limit = 20 } = {}, userId) {
  if (!formId) throw new Error("formId is required.");
  const { Form, FormResponse } = await loadFormModels();

  const form = await Form.findById(formId).lean();
  if (!form) throw new Error("Form not found.");
  assertFormAccess(form, userId);

  const cap = Math.max(1, Math.min(Number(limit) || 20, 30));

  const responses = await FormResponse.find({ form: form._id })
    .sort({ submittedAt: -1 })
    .limit(cap)
    .lean();

  // Merge field labels and position labels into one lookup so votes
  // against positions render with the position title, not the raw id.
  const labelByFieldId = new Map(
    (form.fields || []).map((f) => [f.id, f.label]),
  );
  const labelByPositionId = new Map(
    (form.positions || []).map((p) => [p.id, `${p.title} — vote`]),
  );
  const labelFor = (id) =>
    labelByFieldId.get(id) || labelByPositionId.get(id) || id;

  const isElection = form.type === "election";

  // Candidate-id → name lookup, so election answers read as names.
  const candidateNames = new Map();
  for (const p of form.positions || []) {
    for (const c of p.candidates || []) {
      candidateNames.set(String(c.id), c.name || "(unnamed)");
    }
  }

  const prettifyVote = (value) => {
    const arr = Array.isArray(value) ? value : [value];
    return arr
      .map((v) => candidateNames.get(String(v)) || String(v))
      .join(", ")
      .slice(0, 300);
  };

  return {
    formId: String(form._id),
    title: form.title,
    type: form.type,
    isElection,
    returned: responses.length,
    totalResponses: form.responseCount || 0,
    responses: responses.map((r) => ({
      id: String(r._id),
      email: r.respondentEmail || "",
      name: r.respondentName || "",
      submittedAt: r.submittedAt,
      durationSeconds: r.durationSeconds,
      totalScore: r.totalScore,
      maxScore: r.maxScore,
      percentage: r.percentage,
      passed: r.passed,
      answers: (r.answers || []).slice(0, 30).map((a) => ({
        label: labelFor(a.fieldId),
        value: isElection
          ? prettifyVote(a.value)
          : String(a.value).slice(0, 300),
      })),
    })),
  };
}

async function getFormDetailsTool({ formId } = {}, userId) {
  if (!formId) throw new Error("formId is required.");
  const { Form } = await loadFormModels();

  const form = await Form.findById(formId).lean();
  if (!form) throw new Error("Form not found.");
  assertFormAccess(form, userId);

  const isElection = form.type === "election";

  return {
    formId: String(form._id),
    title: form.title,
    description: form.description,
    type: form.type,
    status: form.status,
    visibility: form.visibility,
    slug: form.slug,
    isMultipage: form.isMultipage,
    settings: form.settings,
    isElection,
    fields: (form.fields || []).slice(0, 60).map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      description: f.description,
      required: f.required,
      options: (f.options || []).slice(0, 20).map((o) => ({
        label: o.label,
        value: o.value,
      })),
      validation: f.validation,
      scoring: f.scoring,
    })),
    positions: (form.positions || []).slice(0, 20).map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      maxSelections: p.maxSelections || 1,
      required: p.required !== false,
      order: p.order,
      candidates: (p.candidates || []).slice(0, 20).map((c) => ({
        id: c.id,
        name: c.name || "",
        slogan: c.slogan || "",
        bio: c.bio || "",
        hasPhoto: Boolean(c.photoUrl),
      })),
    })),
  };
}

export async function runTool(name, args, ctx = {}) {
  switch (name) {
    case "web_search":
      return await webSearch(args.query);
    case "image_search":
      return await imageSearch(args.query, args.count);
    case "fetch_website":
      return await fetchWebsite(args.url);
    case "deep_search":
      return await deepSearch(args.queries);
    case "research_person":
      return await researchPerson(args.name, args.context);
    case "list_user_forms":
      return await listUserForms(args, ctx.userId);
    case "get_form_stats":
      return await getFormStatsTool(args, ctx.userId);
    case "get_form_responses":
      return await getFormResponsesTool(args, ctx.userId);
    case "get_form_details":
      return await getFormDetailsTool(args, ctx.userId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ═════════════════════════════════════════════════════════════════════
// STATUS TEXT
// ═════════════════════════════════════════════════════════════════════

const statusForToolCall = (call) => {
  const name = call?.function?.name;
  let args = {};
  try {
    args = JSON.parse(call?.function?.arguments || "{}");
  } catch {}

  if (name === "web_search")
    return args.query
      ? `Searching for "${truncate(String(args.query), 60)}"`
      : "Searching";
  if (name === "image_search")
    return args.query
      ? `Finding public images of ${truncate(String(args.query), 40)}`
      : "Finding public images";
  if (name === "fetch_website") return "Reading the page";
  if (name === "deep_search") {
    const n = Array.isArray(args.queries) ? args.queries.length : 0;
    return n > 1 ? `Running ${n} searches` : "Searching";
  }
  if (name === "research_person")
    return args.name
      ? `Looking up ${truncate(String(args.name), 40)}`
      : "Looking someone up";
  if (name === "list_user_forms") {
    const q = args.query || args.type;
    return q
      ? `Finding your ${truncate(String(q), 40)} forms`
      : "Looking through your forms";
  }
  if (name === "get_form_stats") return "Reading the form stats";
  if (name === "get_form_responses") return "Pulling recent responses";
  if (name === "get_form_details") return "Reading the form";
  return null;
};

// ═════════════════════════════════════════════════════════════════════
// AGENT LOOP
// ═════════════════════════════════════════════════════════════════════

const INPUT_BUDGET_FRACTION = 0.72;
const SAFETY_MARGIN = 250;
const MAX_TOOL_RESULT_CHARS = 2500;

export async function runAgentTurn({
  systemPrompt,
  history = [],
  userContent,
  model,
  maxIterations = 4,
  temperature = 0.7,
  maxTokens = 2048,
  reasoningEffort,
  onStatus,
  userId,
}) {
  const MAX_SHRINK_ATTEMPTS = 3;
  const MAX_429_WAIT_MS = 15000;
  const MAX_TOOL_CHOICE_RETRIES = 2;
  const executed = [];
  const collectedImages = [];
  const collectedImageSources = [];
  const collectedWhereToFind = [];

  emitStatus(onStatus, "Thinking");

  let available = [];
  try {
    available = await listAvailableModels();
  } catch {}

  const preferred = model || (await resolveTextModel());
  const fullChain = [
    preferred,
    ...TEXT_CANDIDATES.filter(
      (m) => available.includes(m) && m !== preferred && !isCompoundSystem(m),
    ),
    ...HIGH_BUDGET_MODELS.filter((m) => available.includes(m)),
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  const usable = fullChain.filter((m) => !isDailyExhausted(m));
  const chain = usable.length ? usable : fullChain;

  let lastErr = null;

  const finish = (content, attemptModel) => ({
    content,
    model: attemptModel,
    executed,
    images: dedupeByUrl(collectedImages),
    imageSources: dedupeByUrl(collectedImageSources),
    whereToFind: dedupeByUrl(collectedWhereToFind),
  });

  for (const attemptModel of chain) {
    const modelTpm = tpmFor(attemptModel);

    let inputBudget = Math.floor(modelTpm * INPUT_BUDGET_FRACTION);
    let outputBudget = Math.min(
      maxTokens,
      Math.max(400, modelTpm - inputBudget - SAFETY_MARGIN),
    );

    const sysTokens = estimateTokens(systemPrompt);
    const userTokens = estimateTokens(userContent);
    const reserveForUser = Math.max(500, Math.floor(inputBudget * 0.45));
    const reserveForSystem = Math.max(400, Math.floor(inputBudget * 0.35));

    const safeSystem =
      sysTokens > reserveForSystem
        ? clampToTokens(systemPrompt, reserveForSystem)
        : systemPrompt;
    const safeUser =
      userTokens > reserveForUser
        ? clampToTokens(userContent, reserveForUser)
        : userContent;

    if (sysTokens > reserveForSystem) {
      console.warn(
        `⚠️ System prompt (~${sysTokens}t) exceeded budget; clamped to ~${reserveForSystem}t for "${attemptModel}".`,
      );
    }
    if (userTokens > reserveForUser) {
      console.warn(
        `⚠️ User turn (~${userTokens}t) exceeded budget; clamped to ~${reserveForUser}t for "${attemptModel}".`,
      );
    }

    const pinnedTokens =
      estimateTokens(safeSystem) + estimateTokens(safeUser) + SAFETY_MARGIN;

    let trimmedHistory = trimHistoryToBudget(
      [...history],
      pinnedTokens + outputBudget,
      inputBudget,
    );
    const historyBudget = Math.max(
      0,
      inputBudget - pinnedTokens - outputBudget,
    );
    if (historyBudget < 200 && trimmedHistory.length) {
      trimmedHistory = [];
    }

    const currentTurn = { role: "user", content: safeUser };

    const buildMessages = () => [
      { role: "system", content: safeSystem },
      ...trimmedHistory,
      currentTurn,
    ];

    let messages = buildMessages();
    let shrinkAttempts = 0;
    let totalWaitedMs = 0;
    let toolChoiceRetries = 0;

    for (let i = 0; i < maxIterations; i++) {
      const tools = toolsFor(attemptModel);

      const liveInputBudget = Math.max(600, inputBudget - outputBudget);
      messages = trimLiveMessages(messages, liveInputBudget, currentTurn);

      const projectedInput = estimateTokens(messages);
      if (projectedInput + outputBudget > inputBudget) {
        const reduceBy = projectedInput + outputBudget - inputBudget;
        outputBudget = Math.max(400, outputBudget - reduceBy - 100);
      }

      let data;
      try {
        data = await groqChat({
          messages,
          model: attemptModel,
          temperature,
          maxTokens: outputBudget,
          reasoningEffort,
          tools: tools.length ? tools : undefined,
          toolChoice: tools.length ? "auto" : undefined,
        });
      } catch (err) {
        lastErr = err;
        const isOversize = err.status === 413;

        if (err.isDailyLimit) break;

        if (
          err.isToolChoiceMismatch &&
          toolChoiceRetries < MAX_TOOL_CHOICE_RETRIES
        ) {
          toolChoiceRetries++;
          i--;
          continue;
        }

        if (isOversize && shrinkAttempts < MAX_SHRINK_ATTEMPTS) {
          shrinkAttempts++;
          inputBudget = Math.max(1500, Math.floor(inputBudget * 0.55));
          outputBudget = Math.max(400, Math.floor(outputBudget * 0.7));

          const newSysCap = Math.max(400, Math.floor(inputBudget * 0.35));
          const newUserCap = Math.max(500, Math.floor(inputBudget * 0.45));
          const sysNow = estimateTokens(safeSystem);
          const userNow = estimateTokens(safeUser);
          if (sysNow > newSysCap || userNow > newUserCap) {
            const rs =
              sysNow > newSysCap
                ? clampToTokens(systemPrompt, newSysCap)
                : safeSystem;
            const ru =
              userNow > newUserCap
                ? clampToTokens(userContent, newUserCap)
                : safeUser;
            messages = [
              { role: "system", content: rs },
              { role: "user", content: ru },
            ];
            currentTurn.content = ru;
          }
          i--;
          continue;
        }

        if (err.status === 429) {
          if (
            err.keyIndex !== undefined &&
            hasAvailableKeyForModel(attemptModel)
          ) {
            i--;
            continue;
          }

          const { retrySeconds } = parseLimitError(err.detail);
          const waitMs = Math.min(
            (retrySeconds || 3) * 1000 + 250,
            MAX_429_WAIT_MS - totalWaitedMs,
          );
          if (waitMs > 0 && totalWaitedMs < MAX_429_WAIT_MS) {
            await sleep(waitMs);
            totalWaitedMs += waitMs;
            i--;
            continue;
          }
          break;
        }

        if (err.status === 400 && shrinkAttempts === 0 && i === 0) {
          try {
            data = await groqChat({
              messages,
              model: attemptModel,
              temperature,
              maxTokens: outputBudget,
            });
          } catch (err2) {
            lastErr = err2;
            break;
          }
        } else {
          break;
        }
      }

      if (!data) break;

      const choice = data?.choices?.[0]?.message;
      if (!choice) {
        lastErr = new Error("Groq returned an empty response.");
        break;
      }

      for (const t of data?.executed_tools || choice?.executed_tools || [])
        executed.push(t.type || t.name);

      const toolCalls = (choice.tool_calls || []).filter((c) =>
        LOCAL_TOOL_NAMES.has(c.function?.name),
      );

      if (toolCalls.length === 0) {
        const content = messageText(choice);
        if (content) return finish(content, attemptModel);

        messages.push({
          role: "user",
          content:
            "You did not produce an answer. Reply now with the final answer in plain text.",
        });
        continue;
      }

      messages.push({
        role: "assistant",
        content: choice.content || null,
        tool_calls: choice.tool_calls,
      });

      for (const call of choice.tool_calls) {
        let result;
        const statusText = statusForToolCall(call);
        if (statusText) emitStatus(onStatus, statusText);

        if (!LOCAL_TOOL_NAMES.has(call.function?.name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function?.name,
            content: JSON.stringify({
              error: `Unknown tool: ${call.function?.name}`,
            }),
          });
          continue;
        }

        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          result = await runTool(call.function.name, args, { userId });

          if (call.function.name === "image_search") {
            for (const img of result?.images || []) collectedImages.push(img);
            for (const s of result?.sources || [])
              collectedImageSources.push(s);
            for (const s of result?.whereToFind || [])
              collectedWhereToFind.push(s);
          }
          if (call.function.name === "research_person") {
            for (const img of result?.images || []) collectedImages.push(img);
            for (const s of result?.imageSources || [])
              collectedImageSources.push(s);
            for (const s of result?.whereToFind || [])
              collectedWhereToFind.push(s);
          }
        } catch (err) {
          result = { error: err.message };
        }

        const serialized =
          typeof result === "string" ? result : JSON.stringify(result);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content: serialized.slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }
    }

    console.warn(
      `⚠️ "${attemptModel}" could not complete this turn (${
        lastErr?.message || "ran out of iterations"
      }), trying next model.`,
    );
  }

  throw (
    lastErr ||
    new Error("No Groq model in the fallback chain could handle this request.")
  );
}

// ═════════════════════════════════════════════════════════════════════
// SPLIT / MAP-REDUCE FOR BIG REQUESTS
// ═════════════════════════════════════════════════════════════════════

// Split text by character length, then walk back to a paragraph or
// sentence break. Overlap keeps information that straddles a
// boundary from being lost.
export function chunkText(text, targetTokens = 1500, overlapFraction = 0.08) {
  if (typeof text !== "string" || !text) return [];
  const targetChars = Math.max(500, targetTokens * 4);
  const overlapChars = Math.floor(targetChars * overlapFraction);
  if (text.length <= targetChars) return [text];

  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + targetChars);
    if (end < text.length) {
      const para = text.lastIndexOf("\n\n", end);
      const sent = text.lastIndexOf(". ", end);
      const floor = i + Math.floor(targetChars * 0.6);
      if (para > floor) end = para;
      else if (sent > floor) end = sent + 1;
    }
    chunks.push(text.slice(i, end));
    if (end >= text.length) break;
    i = Math.max(end - overlapChars, i + 1);
  }
  return chunks;
}

// Fire N independent prompts concurrently. Each task lands on a
// different key because groqChat's round-robin cursor advances
// synchronously before any network I/O starts.
export async function parallelDispatch(
  tasks,
  { model, temperature = 0.3, maxTokens = 1024, systemPrompt } = {},
) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("parallelDispatch requires a non-empty tasks array.");
  }

  const chosenModel = model || (await resolveTextModel());

  const settled = await Promise.allSettled(
    tasks.map((t) =>
      groqChat({
        messages: [
          { role: "system", content: t.system || systemPrompt || "" },
          { role: "user", content: t.content },
        ],
        model: chosenModel,
        temperature,
        maxTokens,
      }),
    ),
  );

  return settled.map((r, i) => ({
    label: tasks[i].label || `task_${i + 1}`,
    ok: r.status === "fulfilled",
    content:
      r.status === "fulfilled"
        ? messageText(r.value?.choices?.[0]?.message)
        : null,
    error: r.status === "rejected" ? r.reason?.message : null,
  }));
}

// Split a big document, summarize pieces in parallel, merge the
// partials into one answer.
export async function mapReduceDocument({
  systemPrompt = "You are a helpful assistant.",
  document,
  question,
  model,
  onStatus,
  chunkTokens = 1500,
  maxTokens = 800,
}) {
  if (!document || typeof document !== "string") {
    throw new Error("mapReduceDocument requires a document string.");
  }
  if (!question || typeof question !== "string") {
    throw new Error("mapReduceDocument requires a question string.");
  }

  const chunks = chunkText(document, chunkTokens);
  if (chunks.length === 0) throw new Error("Document produced no chunks.");

  // Small enough to handle in one shot.
  if (chunks.length === 1) {
    const data = await groqChat({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${question}\n\n---\n\n${document}` },
      ],
      model,
      maxTokens: maxTokens * 2,
    });
    return {
      content: messageText(data?.choices?.[0]?.message),
      chunks: 1,
      partials: [],
      merged: false,
    };
  }

  if (typeof onStatus === "function") {
    onStatus(`Reading ${chunks.length} parts in parallel`);
  }

  const mapSystem =
    systemPrompt +
    "\n\nYou are processing ONE PART of a larger document. " +
    "Answer the user's question using ONLY information that appears in this part. " +
    "If this part contains nothing relevant, reply exactly: NOTHING RELEVANT IN THIS PART.";

  const partials = await parallelDispatch(
    chunks.map((c, i) => ({
      label: `part_${i + 1}`,
      system: mapSystem,
      content: `Question: ${question}\n\n--- Part ${i + 1} of ${chunks.length} ---\n\n${c}`,
    })),
    { model, temperature: 0.2, maxTokens },
  );

  const usable = partials.filter(
    (p) =>
      p.ok && p.content && !/NOTHING RELEVANT IN THIS PART/i.test(p.content),
  );

  if (usable.length === 0) {
    return {
      content:
        "None of the document parts contained information relevant to that question.",
      chunks: chunks.length,
      partials,
      merged: false,
    };
  }

  if (typeof onStatus === "function") {
    onStatus("Combining the answers");
  }

  const mergeBody = usable
    .map((p) => `### From ${p.label}\n${p.content}`)
    .join("\n\n");

  const mergeSystem =
    "You merge partial answers into ONE final answer. " +
    "Do not mention that the work was split. Do not say 'part 1' or 'the chunks'. " +
    "Write the answer as if you had read the whole document at once.";

  const merged = await groqChat({
    messages: [
      {
        role: "system",
        content: `${systemPrompt}\n\n${mergeSystem}`,
      },
      {
        role: "user",
        content: `Original question: ${question}\n\nPartial answers:\n\n${mergeBody}\n\nWrite the final merged answer.`,
      },
    ],
    model,
    temperature: 0.3,
    maxTokens: maxTokens * 2,
  });

  return {
    content: messageText(merged?.choices?.[0]?.message),
    chunks: chunks.length,
    partials,
    merged: true,
  };
}

// Split a pasted message into document + question.
//
// Heuristic A: explicit separator ("---", "Question:", "Q:")
// Heuristic B: last question sentence near the tail of the text.
function splitDocumentAndQuestion(text) {
  if (typeof text !== "string" || !text) {
    return { document: "", question: "" };
  }

  const sepPatterns = [
    /\n-{3,}\s*\n\s*(?:question|q)\s*[:：]?\s*/i,
    /\n\s*(?:question|q)\s*[:：]\s*/i,
  ];
  for (const re of sepPatterns) {
    const m = re.exec(text);
    if (m && m.index > 0) {
      const document = text.slice(0, m.index).trim();
      const question = text.slice(m.index + m[0].length).trim();
      if (document && question) return { document, question };
    }
  }

  const tailStart = Math.floor(text.length * 0.8);
  const tail = text.slice(tailStart);
  const qMatch = tail.lastIndexOf("?");
  if (qMatch !== -1) {
    const beforeQ = tail.slice(0, qMatch);
    const dotIdx = Math.max(
      beforeQ.lastIndexOf(". "),
      beforeQ.lastIndexOf("\n"),
    );
    const qStart = dotIdx === -1 ? 0 : dotIdx + 1;
    const question = tail.slice(qStart, qMatch + 1).trim();
    if (question.length > 5 && question.length < 500) {
      const absoluteQStart = tailStart + qStart;
      const document = text.slice(0, absoluteQStart).trim();
      if (document) return { document, question };
    }
  }

  return { document: "", question: "" };
}

// Drop-in replacement for runAgentTurn. Decides between three paths:
//   1. Small request      → runAgentTurn (normal agent loop)
//   2. Big pasted doc     → mapReduceDocument (split + merge)
//   3. Big non-doc        → runAgentTurn (clamps + trims)
export async function runSmartTurn({
  systemPrompt,
  history = [],
  userContent,
  model,
  onStatus,
  userId,
  preferDecomposition = true,
  documentThresholdTokens = 4000,
  chunkTokens = 1500,
  maxTokens = 2048,
}) {
  const userTokens = estimateTokens(userContent);
  const sysTokens = estimateTokens(systemPrompt);
  const histTokens = estimateTokens(history);
  const totalInput = userTokens + sysTokens + histTokens;

  const userDominant = userTokens / Math.max(1, totalInput) > 0.5;
  const isSingleTurn = !history || history.length === 0;
  const isBig = userTokens > documentThresholdTokens;

  if (preferDecomposition && isSingleTurn && userDominant && isBig) {
    const { document, question } = splitDocumentAndQuestion(userContent);

    if (document && question && estimateTokens(document) > 1500) {
      if (typeof onStatus === "function") {
        onStatus("Big request — splitting into parts");
      }
      const r = await mapReduceDocument({
        systemPrompt,
        document,
        question,
        model,
        onStatus,
        chunkTokens,
        maxTokens: Math.min(1000, Math.floor(maxTokens / 2)),
      });
      return {
        content: r.content,
        model: model || "decomposed",
        executed: [],
        images: [],
        imageSources: [],
        whereToFind: [],
        decomposed: true,
        chunks: r.chunks,
      };
    }
  }

  return runAgentTurn({
    systemPrompt,
    history,
    userContent,
    model,
    onStatus,
    userId,
    maxTokens,
  });
}

// ═════════════════════════════════════════════════════════════════════
// MEMORY EXTRACTION
// ═════════════════════════════════════════════════════════════════════

const MEMORY_CHAR_CAP = 600;

export async function extractUserMemories({
  userMessage,
  assistantReply,
  recentHistory = [],
}) {
  const cap = (s) => (typeof s === "string" ? s.slice(0, MEMORY_CHAR_CAP) : "");

  const context = [
    ...recentHistory
      .slice(-3)
      .map((m) => `${m.role.toUpperCase()}: ${cap(m.content)}`),
    `USER: ${cap(userMessage)}`,
    `ASSISTANT: ${cap(assistantReply)}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await groqJSONFast({
      messages: [
        {
          role: "system",
          content: `Extract durable facts about the USER from a conversation turn.

Only extract things that are true about the user and worth remembering long-term:
- name, location, age, school, job, relationship status
- preferences (tone, format)
- interests, favourites
- projects they're working on
- important dates

Do NOT extract: questions, transient info, assistant statements, inferences.

Return STRICT JSON only.`,
        },
        {
          role: "user",
          content: `Turn:\n${context}\n\nReturn: {"memories":[{"category":"identity"|"preference"|"interest"|"project"|"fact","text":"...","importance":0.0-1.0}]}\nEmpty array if nothing durable. Max 4.`,
        },
      ],
      temperature: 0.2,
      maxTokens: 400,
    });

    const memories = Array.isArray(result?.memories) ? result.memories : [];
    return memories
      .filter((m) => m?.text && typeof m.text === "string")
      .slice(0, 4)
      .map((m) => ({
        category: [
          "identity",
          "preference",
          "interest",
          "project",
          "fact",
        ].includes(m.category)
          ? m.category
          : "fact",
        text: m.text.trim().slice(0, 300),
        importance: Math.min(Math.max(Number(m.importance) || 0.5, 0), 1),
      }));
  } catch (err) {
    if (err?.isDailyLimit || err?.status === 429) return [];
    console.warn("⚠️ Memory extraction failed:", err.message);
    return [];
  }
}

// ═════════════════════════════════════════════════════════════════════
// VISION
// ═════════════════════════════════════════════════════════════════════

export async function groqVision({
  system,
  prompt,
  imageUrl,
  model,
  temperature = 0.3,
}) {
  const chosenModel = model || (await resolveVisionModel());

  const data = await groqChat({
    model: chosenModel,
    temperature,
    maxTokens: 2048,
    messages: [
      { role: "system", content: clampToTokens(system, 800) },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  return messageText(data?.choices?.[0]?.message);
}