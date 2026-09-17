// utils/xamutAI.js
//
// Groq-backed AI service.
// Env vars are read lazily so nothing depends on dotenv import order.
//
// Model resolution, TPM budgeting, tool calling, image search, live
// status streaming.

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_URL = `${GROQ_BASE}/chat/completions`;
const MODELS_URL = `${GROQ_BASE}/models`;

const getGroqKey = () => process.env.GROQ_API_KEY;

const TEXT_CANDIDATES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
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

// ─────────────────────────────────────────────────────────────────────
// Public image sources
//
// When the user asks to see a picture of someone or something, we hand
// them real public archive links. Tavily's image search may or may not
// return direct image URLs on every plan, so this is the reliable
// fallback: always give the user somewhere real to go look.
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

  const match = candidates.find((c) => available.includes(c));
  if (match) return match;

  const generic = available.find(
    (m) =>
      !/whisper|guard|orpheus|tts|embed/i.test(m) && !m.startsWith("groq/compound")
  );
  if (generic) return generic;

  throw new Error(`No usable chat model. Available: ${available.join(", ")}`);
}

export const resolveTextModel = () =>
  pickModel(TEXT_CANDIDATES, process.env.GROQ_TEXT_MODEL);
export const resolveVisionModel = () =>
  pickModel(VISION_CANDIDATES, process.env.GROQ_VISION_MODEL);
export const getTextModel = () =>
  process.env.GROQ_TEXT_MODEL || TEXT_CANDIDATES[0];
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

  const body = {
    model: chosenModel,
    messages,
    temperature,
    max_completion_tokens: maxTokens,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
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
    if (res.status === 413 || res.status === 429) {
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

// ─────────────────────────────────────────────────────────────────────
// Tools
//
// Note: the descriptions are intentionally broad. The model uses them
// to decide WHEN to call the tool, so anything that reads like a
// restriction ("public figure", "celebrity") will cause it to skip the
// tool for smaller names. Keep them open.
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

// imageSearch — Tavily with include_images, plus a public-archive
// fallback list so the model always has real links to hand the user.
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

  // Tavily returns either strings or { url, description } depending on plan
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

// researchPerson — broad lookup, no celebrity filter. Handles
// personal brands, indie devs, small studios, single-name creators,
// agencies, portfolio sites, anyone with a web footprint.
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

export async function runTool(name, args) {
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
}) {
  const SAFETY_MARGIN = 250;
  const MAX_SHRINK_ATTEMPTS = 3;
  const MAX_429_WAIT_MS = 15000;
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
  const chain = [
    preferred,
    ...TEXT_CANDIDATES.filter(
      (m) => available.includes(m) && m !== preferred && !isCompoundSystem(m)
    ),
    ...HIGH_BUDGET_MODELS.filter((m) => available.includes(m)),
  ].filter((m, i, arr) => arr.indexOf(m) === i);

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
          toolChoice: tools.length ? "auto" : undefined,
        });
      } catch (err) {
        lastErr = err;

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
            emitStatus(
              onStatus,
              `Waiting ${Math.round(waitMs / 1000)}s on the rate limit`
            );
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

        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          result = await runTool(call.function.name, args);

          // Collect images and public source links so the frontend can
          // render them alongside the text reply.
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
// Memory extraction — used by the controller after every turn
// ─────────────────────────────────────────────────────────────────────
export async function extractUserMemories({ userMessage, assistantReply, recentHistory = [] }) {
  const context = [
    ...recentHistory.slice(-4).map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    `USER: ${userMessage}`,
    `ASSISTANT: ${assistantReply}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await groqJSON({
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