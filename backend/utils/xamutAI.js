// utils/xamutAI.js
//
// Groq-backed AI service.
// Env vars are read lazily so nothing depends on dotenv import order.
//
// Model resolution, TPM budgeting, tool calling, image search, live
// status streaming.
//
// Two model pools:
//   • TEXT_CANDIDATES  — big models for real chat turns
//   • FAST_CANDIDATES  — small models for background calls (intent
//                        detection, memory extraction, JSON parsing)
//
// Groq gives each model its own daily token budget (TPD). Routing
// background work to a smaller model keeps the big model's budget
// free for actual replies, which roughly triples how far one day
// of free-tier usage goes.
//
// Rate-limit note: 429 backoff is silent. The user's last status
// ("Thinking", "Searching for X") stays on screen while we sleep
// and retry. We never surface "waiting N seconds on the rate limit"
// — that's infrastructure plumbing, not something a user should see.
//
// Tool-choice note: GPT-OSS models (openai/gpt-oss-*) have a native,
// baked-in impulse to call tools even when none are declared. If we
// send a request with no tools and no explicit tool_choice, Groq
// treats that as tool_choice:"none" and rejects the whole thing with
// a 400 the moment the model reaches for a tool. The fix is to always
// declare tool_choice:"auto" for models that support tool calling,
// and to add disable_tool_validation for GPT-OSS so a hallucinated
// call doesn't blow up the request.
//
// Form lookup note: the four tools at the bottom of the TOOLS array
// (list_user_forms, get_form_stats, get_form_responses,
// get_form_details) query the user's OWN forms in Mongo. They exist
// because the model kept trying to web-search for "my attendance form"
// and hallucinating general-knowledge answers. runAgentTurn passes
// the userId down through ctx so these tools know whose forms to load.
//
// Fuzzy-match note: list_user_forms used to regex-match the ENTIRE
// raw user phrase against the title ("application form for obong fc"
// as one literal substring), which almost never matches a real title
// like "Obong FC Membership Sign-Up". It now strips filler words and
// matches on the remaining keywords, ranked by how many hit.

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_URL = `${GROQ_BASE}/chat/completions`;
const MODELS_URL = `${GROQ_BASE}/models`;

const getGroqKey = () => process.env.GROQ_API_KEY;

// Main chat: prefer quality.
const TEXT_CANDIDATES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "llama-3.3-70b-versatile",
];

// Background work: prefer speed and cheaper budget.
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

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// Form constants (shared between the tools and the executors)
// ─────────────────────────────────────────────────────────────────────
const FORM_TYPES = ["form", "quiz", "survey", "feedback", "attendance"];

const CHOICE_TYPES = new Set([
  "radio",
  "checkbox",
  "dropdown",
  "multi_select",
]);

// Words that carry no identifying signal for a form title. Stripped
// out before fuzzy-matching a free-text query like "what's the
// current stats on the application form for obong fc" down to the
// words that actually distinguish one form from another ("obong",
// "fc").
const FORM_QUERY_STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "on", "in", "to", "my", "is", "are",
  "was", "were", "be", "been", "what", "whats", "what's", "which",
  "who", "whom", "how", "when", "where", "why", "current", "latest",
  "recent", "stat", "stats", "statistic", "statistics", "status",
  "form", "forms", "quiz", "quizzes", "survey", "surveys", "feedback",
  "attendance", "application", "please", "show", "tell", "me", "about",
  "many", "much", "response", "responses", "submission", "submissions",
  "result", "results", "data", "info", "information", "get", "give",
  "list", "your", "you", "do", "does", "did", "have", "has", "had",
  "this", "that", "these", "those", "and", "or", "with", "from",
  "i", "it", "can", "could", "would", "check", "look", "up",
]);

const extractFormKeywords = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FORM_QUERY_STOPWORDS.has(w));

// ─────────────────────────────────────────────────────────────────────
// Daily budget tracking
//
// Groq enforces a tokens-per-day cap per model. When we get a "tokens
// per day (TPD)" 429, park that model until the retry-after window
// expires so we stop hammering it. Prevents log spam and pointless
// retries, and lets the model chain fall through to a model that
// still has budget.
// ─────────────────────────────────────────────────────────────────────
const _dailyExhausted = new Map(); // model -> resetAt (ms epoch)

export const isDailyExhausted = (model) => {
  const resetAt = _dailyExhausted.get(model);
  if (!resetAt) return false;
  if (Date.now() >= resetAt) {
    _dailyExhausted.delete(model);
    return false;
  }
  return true;
};

const markDailyExhausted = (model, retryAfterSeconds) => {
  const seconds = Number(retryAfterSeconds);
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  _dailyExhausted.set(model, Date.now() + safe * 1000);
};

const isDailyLimitError = (detail = "") => {
  if (typeof detail !== "string") return false;
  return (
    /tokens per day\s*\(TPD\)/i.test(detail) ||
    /on tokens per day/i.test(detail)
  );
};

// ─────────────────────────────────────────────────────────────────────
// Public image sources
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// TPM budgets
// ─────────────────────────────────────────────────────────────────────
const DEFAULT_TPM = {
  "openai/gpt-oss-120b": 8000,
  "openai/gpt-oss-20b": 8000,
  "openai/gpt-oss-safeguard-20b": 8000,
  "qwen/qwen3.8-27b": 8000,
  "qwen/qwen3.6-27b": 8000,
  "groq/compound": 70000,
  "groq/compound-mini": 70000,
  "llama-3.3-70b-versatile": 8000,
};
const _learnedTpm = new Map();
const tpmFor = (model) => _learnedTpm.get(model) || DEFAULT_TPM[model] || 8000;
const learnTpm = (model, limit) => {
  if (limit && Number.isFinite(limit)) _learnedTpm.set(model, limit);
};

// ─────────────────────────────────────────────────────────────────────
// Token estimation
// ─────────────────────────────────────────────────────────────────────
const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((c) => c.text || "").join(" ");
  return "";
};

export const estimateTokens = (input) => {
  if (typeof input === "string") return Math.ceil(input.length / 4) + 4;
  if (Array.isArray(input))
    return input.reduce((sum, m) => sum + estimateTokens(textOf(m.content)), 0);
  return 0;
};

const trimHistoryToBudget = (history, fixedTokens, budget) => {
  let trimmed = [...history];
  while (
    trimmed.length > 0 &&
    fixedTokens + estimateTokens(trimmed) > budget
  ) {
    trimmed.shift();
  }
  return trimmed;
};

// ─────────────────────────────────────────────────────────────────────
// Model discovery
// ─────────────────────────────────────────────────────────────────────
let _modelCache = null;
let _modelCachePromise = null;

export async function listAvailableModels({ force = false } = {}) {
  const GROQ_KEY = getGroqKey();
  if (!GROQ_KEY)
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your .env and restart the server."
    );

  if (_modelCache && !force) return _modelCache;
  if (_modelCachePromise && !force) return _modelCachePromise;

  _modelCachePromise = (async () => {
    const res = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Could not list Groq models (${res.status}): ${body.slice(0, 300)}`
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

  // Prefer candidates that aren't day-exhausted, but fall back to the
  // full list if every candidate is exhausted (nothing to gain by
  // refusing to try).
  const usable = available.filter((m) => !isDailyExhausted(m));
  const pool = usable.length ? usable : available;

  const match = candidates.find((c) => pool.includes(c));
  if (match) return match;

  const generic = pool.find(
    (m) =>
      !/whisper|guard|orpheus|tts|embed/i.test(m) && !m.startsWith("groq/compound")
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

// ─────────────────────────────────────────────────────────────────────
// Core call
// ─────────────────────────────────────────────────────────────────────
const parseLimitError = (detail = "") => {
  const limit = Number(/Limit (\d+)/i.exec(detail)?.[1]);
  const requested = Number(/Requested (\d+)/i.exec(detail)?.[1]);
  const retrySeconds = Number(
    /(?:try again in|retry.{0,3}after)\s*([\d.]+)\s*s/i.exec(detail)?.[1]
  );
  const namedModel = /model `([^`]+)`/i.exec(detail)?.[1] || null;
  return {
    limit: Number.isFinite(limit) ? limit : null,
    requested: Number.isFinite(requested) ? requested : null,
    retrySeconds: Number.isFinite(retrySeconds) ? retrySeconds : null,
    namedModel,
  };
};

// Detect the specific GPT-OSS 400 where the model hallucinated a tool
// call with no tools declared. This is a model-behaviour issue, not a
// request issue, and the right recovery is a same-model retry.
const isToolChoiceMismatchError = (detail = "") =>
  typeof detail === "string" &&
  /tool choice is none,? but model called a tool/i.test(detail);

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
  const GROQ_KEY = getGroqKey();
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY is not set.");

  const chosenModel = model || (await resolveTextModel());

  // Short-circuit if we already know this model is parked for the day.
  if (isDailyExhausted(chosenModel)) {
    const err = new Error(
      `Groq daily token budget for "${chosenModel}" is exhausted. Try again later.`
    );
    err.status = 429;
    err.model = chosenModel;
    err.isDailyLimit = true;
    err.detail = "tokens per day (TPD) exhausted";
    throw err;
  }

  const body = {
    model: chosenModel,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
  };

  if (jsonMode) body.response_format = { type: "json_object" };

  // ── Tool wiring ────────────────────────────────────────────────
  // GPT-OSS models reach for tools even when none are declared, and
  // Groq rejects that with a 400 ("Tool choice is none, but model
  // called a tool"). The fix is to make the tool contract explicit:
  //
  //   • If we have tools to declare, pass them with tool_choice:auto.
  //   • If we don't, but the model is one that has native tool-calling
  //     impulses (GPT-OSS), still pass tool_choice:auto + an empty
  //     tools array + disable_tool_validation. That way if the model
  //     hallucinates a call, Groq returns it instead of 400-ing, and
  //     our loop just ignores unknown tools.
  //   • Never leave tool_choice unset on a model that supports tool
  //     calling, because "unset" is treated as "none" by the validator.
  //
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
  // For non-GPT-OSS models (llama, qwen, compound), leave tools and
  // tool_choice off entirely. They don't spontaneously call tools, so
  // omitting the parameters is safe and keeps the request minimal.

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

    if (res.status === 429 && daily) {
      const { retrySeconds, namedModel } = parseLimitError(detail);
      // Park whichever model the error names, falling back to the one
      // we called if the error doesn't say.
      markDailyExhausted(namedModel || chosenModel, retrySeconds || 60);
    }

    if ((res.status === 413 || res.status === 429) && !daily) {
      // Only learn per-minute budgets from non-TPD rate limit errors.
      // A TPD error message also contains "Limit 200000" and if we
      // learned that as TPM, we'd never trim history again.
      const { limit, namedModel } = parseLimitError(detail);
      if (!namedModel || namedModel === chosenModel) {
        learnTpm(chosenModel, limit);
      }
    }

    const err = new Error(
      `Groq ${res.status} on "${chosenModel}": ${
        detail?.slice ? detail.slice(0, 500) : detail || res.statusText
      }`
    );
    err.status = res.status;
    err.model = chosenModel;
    err.detail = detail || "";
    err.isDailyLimit = daily;
    err.isToolChoiceMismatch = toolMismatch;
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

// Convenience wrappers that default to the fast model. Use these for
// background work (intent classification, memory extraction) so the
// big model's daily budget stays free for real replies.
export async function groqTextFast(args) {
  const model = args.model || (await resolveFastModel());
  return groqText({ ...args, model });
}

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
  try {
    const raw = await groqText({ ...args, jsonMode: true, tools: undefined });
    return extractJson(raw);
  } catch (err) {
    const isValidationFailure =
      err.status === 400 && /validate json/i.test(err.detail || "");
    const isParseFailure = !err.status;

    // A GPT-OSS tool-choice mismatch on a JSON call is recoverable:
    // just retry the same request. The model's urge to call a tool is
    // probabilistic, not deterministic, so the second attempt usually
    // comes back clean.
    if (err.isToolChoiceMismatch) {
      const raw = await groqText({
        ...args,
        jsonMode: true,
        tools: undefined,
      });
      return extractJson(raw);
    }

    if (!isValidationFailure && !isParseFailure) throw err;

    const retryMessages = [
      ...args.messages,
      {
        role: "user",
        content:
          "Your previous response was not valid JSON. Reply again with ONLY a single valid JSON object, nothing before or after it, no markdown fences, no explanation. Keep it as short as possible while still matching the required shape.",
      },
    ];

    const raw = await groqText({
      ...args,
      messages: retryMessages,
      jsonMode: true,
      tools: undefined,
      maxTokens: Math.max(args.maxTokens || 0, 800),
      temperature: Math.min(args.temperature ?? 0.6, 0.3),
    });
    return extractJson(raw);
  }
}

export async function groqJSONFast(args) {
  const model = args.model || (await resolveFastModel());
  return groqJSON({ ...args, model });
}

// ─────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current information about anything: people, brands, businesses, products, creators, events, prices, tools, code, whatever. Use this whenever you're not 100% sure of the answer or the name is unfamiliar. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
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
        properties: {
          url: { type: "string" },
        },
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
        properties: {
          queries: {
            type: "array",
            items: { type: "string" },
          },
        },
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
        "List the current user's own forms. Use this ANY time the user asks about their own forms: 'my forms', 'my quiz', 'my attendance form', 'the survey I made', 'how many forms have I made', 'do I have a feedback form', 'list my surveys', 'show me my forms'. Supports fuzzy title matching and type filtering. Returns an array of forms with id, title, type, status, response count, and field count. If the user's reference is ambiguous (they have three attendance forms), this returns ALL matches so you can ask which one they mean. NEVER web search for the user's own forms — this is the tool for that.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Fuzzy text to match against form titles, or a type name like 'attendance' or 'quiz'. Omit to list every form the user has access to.",
          },
          type: {
            type: "string",
            enum: ["form", "quiz", "survey", "feedback", "attendance"],
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
        "Get detailed stats on ONE specific form the user owns: total responses, average completion time, per-field answer breakdowns, quiz scores, pass rate, response rate for private forms. Use this after list_user_forms, when the user's question is about a specific form: 'stats on my attendance form', 'how many responses', 'average score on my quiz', 'pass rate', 'leaderboard', 'who answered what', 'how did people answer question 3'. Requires a formId from list_user_forms.",
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
        "List recent submissions to one of the user's forms, with each respondent's answers. Use for 'show me the responses', 'who filled it out', 'recent submissions', 'list the answers', 'what did people say'. Requires a formId from list_user_forms.",
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
        "Fetch the full definition of a form the user owns: title, description, type, visibility, and every field with its options, validation, and scoring. Use for 'what's on my form', 'show me the questions', 'list the fields', 'what does my quiz ask'. Requires a formId from list_user_forms.",
      parameters: {
        type: "object",
        properties: {
          formId: { type: "string" },
        },
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

// ─────────────────────────────────────────────────────────────────────
// Local tool executors
// ─────────────────────────────────────────────────────────────────────
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
    throw new Error(`Image search failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();

  const raw = data.images || [];
  const images = raw
    .map((img) =>
      typeof img === "string"
        ? { url: img, description: "" }
        : { url: img.url || img, description: img.description || "" }
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
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http(s).");

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

  return text.slice(0, 20000);
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
      webSearch(q.trim(), 5).catch(() => ({ answer: "", results: [] }))
    )
  );

  const seen = new Set();
  const merged = [];
  for (let i = 0; i < results.length; i++) {
    for (const item of results[i].results || []) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push({ ...item, fromQuery: capped[i] });
      if (merged.length >= 20) break;
    }
    if (merged.length >= 20) break;
  }

  return {
    queries: capped,
    answers: results.map((r) => r.answer).filter(Boolean),
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
        webSearch(q, 4).catch(() => ({ answer: "", results: [] }))
      )
    ),
    imageSearch(base, 6).catch(() => ({
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
      if (merged.length >= 18) break;
    }
    if (merged.length >= 18) break;
  }

  return {
    name,
    context: context || null,
    answer: textResults
      .map((r) => r.answer)
      .filter(Boolean)
      .join(" ")
      .slice(0, 1500),
    sources: merged,
    images: imageResults.images || [],
    imageSources: imageResults.sources || [],
    whereToFind:
      imageResults.whereToFind?.length
        ? imageResults.whereToFind
        : publicImageSources(base),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Form lookup executors
//
// These query the user's OWN forms in Mongo. They're wired through
// runTool so the agentic loop can chain them: list → stats, or
// list → responses. The userId is passed down from runAgentTurn via
// the ctx argument.
//
// Models are imported lazily to avoid a circular import at module load
// (models/formModel.js imports nothing from here, but keeping the lazy
// boundary clean makes the dependency direction obvious).
// ─────────────────────────────────────────────────────────────────────
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

// Fuzzy-matches a free-text query ("application form for obong fc")
// against the user's forms by keyword overlap rather than requiring
// the whole phrase to appear verbatim in the title. Falls back to a
// plain substring match if the query is nothing but filler words.
async function listUserForms({ query, type } = {}, userId) {
  if (!userId) throw new Error("No user context for form lookup.");
  const { Form } = await loadFormModels();

  const and = [
    { $or: [{ owner: userId }, { "collaborators.user": userId }] },
  ];
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
      // Query was nothing but filler words ("the form", "my forms") —
      // fall back to matching the raw phrase so we don't accidentally
      // return every form the user has.
      ors.push({ title: { $regex: escapeRegex(trimmed), $options: "i" } });
    }

    const lower = trimmed.toLowerCase();
    const typeMatches = FORM_TYPES.filter(
      (t) => lower.includes(t) || t.includes(lower)
    );
    if (typeMatches.length) ors.push({ type: { $in: typeMatches } });

    and.push({ $or: ors });
  }

  let forms = await Form.find({ $and: and })
    .select(
      "owner title type status visibility responseCount fields collaborators createdAt updatedAt"
    )
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  // Rank by how many keywords actually appear in the title, so a
  // close match ("Obong FC Membership Sign-Up" for "obong fc") floats
  // above a coincidental type-only match, instead of just sorting by
  // most-recently-updated.
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
    forms: forms.map((f) => ({
      id: String(f._id),
      title: f.title,
      type: f.type,
      status: f.status,
      visibility: f.visibility,
      responseCount: f.responseCount || 0,
      fieldCount: (f.fields || []).filter((x) => x.type !== "section").length,
      owned: String(f.owner) === uid,
      updatedAt: f.updatedAt,
    })),
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

  const responses = await FormResponse.find({ form: form._id }).lean();
  const total = responses.length;

  const durations = responses
    .map((r) => r.durationSeconds || 0)
    .filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const isQuiz =
    form.type === "quiz" ||
    (form.fields || []).some((f) => (f.scoring?.points || 0) > 0);
  const maxScore = (form.fields || []).reduce(
    (sum, f) => sum + (f.scoring?.points || 0),
    0
  );

  const scores = responses.map((r) => r.totalScore || 0);
  const percentages = responses.map((r) => r.percentage || 0);
  const avgScore = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const avgPct = percentages.length
    ? percentages.reduce((a, b) => a + b, 0) / percentages.length
    : 0;
  const passedCount = responses.filter((r) => r.passed === true).length;

  const fields = (form.fields || [])
    .filter((f) => f.type !== "section")
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
          for (const v of arr) counts[String(v)] = (counts[String(v)] || 0) + 1;
        }
        base.options = (f.options || []).map((o) => ({
          label: o.label,
          value: o.value,
          count: counts[o.value] || 0,
        }));
        base.mostChosen =
          base.options.slice().sort((a, b) => b.count - a.count)[0]?.label ||
          null;
      } else if (["number", "rating", "scale"].includes(f.type)) {
        const nums = values.map((a) => Number(a.value)).filter(Number.isFinite);
        if (nums.length) {
          base.min = Math.min(...nums);
          base.max = Math.max(...nums);
          base.avg = Number(
            (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)
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
          .slice(-10)
          .reverse()
          .map((a) => String(a.value).slice(0, 200));
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
    responseRate,
    fields,
  };
}

async function getFormResponsesTool({ formId, limit = 20 } = {}, userId) {
  if (!formId) throw new Error("formId is required.");
  const { Form, FormResponse } = await loadFormModels();

  const form = await Form.findById(formId).lean();
  if (!form) throw new Error("Form not found.");
  assertFormAccess(form, userId);

  const cap = Math.max(1, Math.min(Number(limit) || 20, 100));

  const responses = await FormResponse.find({ form: form._id })
    .sort({ submittedAt: -1 })
    .limit(cap)
    .lean();

  const labelByFieldId = new Map(
    (form.fields || []).map((f) => [f.id, f.label])
  );

  return {
    formId: String(form._id),
    title: form.title,
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
      answers: (r.answers || []).map((a) => ({
        label: labelByFieldId.get(a.fieldId) || a.fieldId,
        value: a.value,
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
    fields: (form.fields || []).map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      description: f.description,
      required: f.required,
      options: (f.options || []).map((o) => ({
        label: o.label,
        value: o.value,
      })),
      validation: f.validation,
      scoring: f.scoring,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tool dispatcher
//
// ctx carries per-turn context (currently just userId) so tools that
// need to scope queries to the current user can do so.
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// Status text for streaming
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// Agentic loop
// ─────────────────────────────────────────────────────────────────────
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
  const SAFETY_MARGIN = 250;
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
      (m) => available.includes(m) && m !== preferred && !isCompoundSystem(m)
    ),
    ...HIGH_BUDGET_MODELS.filter((m) => available.includes(m)),
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  // Prefer models that still have daily budget. If every candidate is
  // parked, fall through to the full chain so we at least try.
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
    let outputBudget = maxTokens;
    let trimmedHistory = [...history];

    const fixedTokens = () =>
      estimateTokens(systemPrompt) +
      estimateTokens(userContent) +
      SAFETY_MARGIN +
      outputBudget;

    trimmedHistory = trimHistoryToBudget(
      trimmedHistory,
      fixedTokens(),
      tpmFor(attemptModel)
    );

    const buildMessages = () => [
      { role: "system", content: systemPrompt },
      ...trimmedHistory,
      { role: "user", content: userContent },
    ];

    let messages = buildMessages();
    let shrinkAttempts = 0;
    let totalWaitedMs = 0;
    let toolChoiceRetries = 0;

    for (let i = 0; i < maxIterations; i++) {
      const tools = toolsFor(attemptModel);
      let data;

      try {
        data = await groqChat({
          messages,
          model: attemptModel,
          temperature,
          maxTokens: outputBudget,
          reasoningEffort,
          tools: tools.length ? tools : undefined,
          // Always pass "auto" when we have tools. Never pass "none".
          // GPT-OSS will reach for tools regardless, and "none" turns
          // that into a hard 400.
          toolChoice: tools.length ? "auto" : undefined,
        });
      } catch (err) {
        lastErr = err;

        // Daily budget exhausted. Don't retry, move to the next model
        // in the chain.
        if (err.isDailyLimit) {
          break;
        }

        // GPT-OSS hallucinated a tool call on a request where we
        // couldn't declare tools. Retry the same model — the impulse
        // is probabilistic, so a second pass usually comes back clean.
        if (
          err.isToolChoiceMismatch &&
          toolChoiceRetries < MAX_TOOL_CHOICE_RETRIES
        ) {
          toolChoiceRetries++;
          i--;
          continue;
        }

        if (err.status === 413 && shrinkAttempts < MAX_SHRINK_ATTEMPTS) {
          shrinkAttempts++;
          outputBudget = Math.max(400, Math.floor(outputBudget * 0.6));
          trimmedHistory = trimHistoryToBudget(
            trimmedHistory,
            fixedTokens(),
            tpmFor(attemptModel)
          );
          messages = buildMessages();
          i--;
          continue;
        }

        if (err.status === 429) {
          const { retrySeconds } = parseLimitError(err.detail);
          const waitMs = Math.min(
            (retrySeconds || 3) * 1000 + 250,
            MAX_429_WAIT_MS - totalWaitedMs
          );
          if (waitMs > 0 && totalWaitedMs < MAX_429_WAIT_MS) {
            // Silent backoff. We deliberately do NOT emit a status
            // here — the user shouldn't see rate-limit plumbing. The
            // last status text stays on screen while we sleep and
            // retry, which reads as normal AI latency.
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

      // Only act on tool calls we actually know how to run. GPT-OSS
      // sometimes invents tool names (or returns built-in ones like
      // browser_search) — those just pass through to the next turn
      // without us trying to execute them.
      const toolCalls = (choice.tool_calls || []).filter((c) =>
        LOCAL_TOOL_NAMES.has(c.function?.name)
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

        // Skip execution for tools we don't recognise — but still
        // hand back a valid tool message so the conversation can
        // continue without Groq complaining about a missing reply.
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
            for (const s of result?.sources || []) collectedImageSources.push(s);
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

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content:
            typeof result === "string"
              ? result
              : JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    console.warn(
      `⚠️ "${attemptModel}" could not complete this turn (${
        lastErr?.message || "ran out of iterations"
      }), trying next model.`
    );
  }

  throw (
    lastErr ||
    new Error("No Groq model in the fallback chain could handle this request.")
  );
}

// ─────────────────────────────────────────────────────────────────────
// Memory extraction
//
// Routed to the fast model. Handles daily budget errors silently —
// memory is a nice-to-have, it should never spam the log or block a
// turn.
// ─────────────────────────────────────────────────────────────────────
export async function extractUserMemories({
  userMessage,
  assistantReply,
  recentHistory = [],
}) {
  const context = [
    ...recentHistory.slice(-4).map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    `USER: ${userMessage}`,
    `ASSISTANT: ${assistantReply}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await groqJSONFast({
      messages: [
        {
          role: "system",
          content: `You extract durable facts about the USER from a conversation turn.

Only extract things that are true about the user and worth remembering long-term:
- name, location, age, school, job, relationship status
- preferences (how they like responses, tone, format)
- interests, favourites (teams, celebs, music, shows)
- projects they're working on
- important dates or events

Do NOT extract:
- things the user was just asking about (a question is not a fact)
- transient info ("I'm tired today")
- assistant's own statements
- anything the assistant inferred without the user saying it

Return STRICT JSON only.`,
        },
        {
          role: "user",
          content: `Conversation turn:

${context}

Return JSON exactly:
{
  "memories": [
    {
      "category": "identity" | "preference" | "interest" | "project" | "fact",
      "text": "short statement, e.g. 'Their name is Samuel'",
      "importance": number between 0 and 1
    }
  ]
}

Return an empty array if there's nothing durable. Max 4 memories per turn.`,
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
        category: ["identity", "preference", "interest", "project", "fact"].includes(
          m.category
        )
          ? m.category
          : "fact",
        text: m.text.trim().slice(0, 300),
        importance: Math.min(Math.max(Number(m.importance) || 0.5, 0), 1),
      }));
  } catch (err) {
    // Daily budget exhausted: skip silently. It'll work tomorrow.
    if (err?.isDailyLimit || err?.status === 429) {
      return [];
    }
    console.warn("⚠️ Memory extraction failed:", err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Vision
// ─────────────────────────────────────────────────────────────────────
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
      { role: "system", content: system },
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