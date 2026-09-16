// utils/xamutAI.js
//
// Groq-backed AI service.
// Env vars are read lazily so nothing depends on dotenv import order.
//
// Models are RESOLVED AT RUNTIME against GET /v1/models, so a model being
// retired or moved behind an enterprise plan degrades instead of 404-ing.
//
// Web access: GPT-OSS models get Groq's SERVER-SIDE browser_search built-in
// (no API key of your own needed). Tavily is only used as an extra local
// function when TAVILY_API_KEY happens to be set.
//
// TPM budgeting: gpt-oss-120b / gpt-oss-20b / qwen3.8-27b are capped at 8,000
// tokens-per-minute on the free plan — input + reserved output both count.
// groq/compound and groq/compound-mini get 70,000. Before every agent call we
// estimate the request size and trim history/output to fit; if Groq still
// rejects it with a 413, we parse the real limit out of the error, shrink
// further, and as a last resort fall over to groq/compound for that turn.
//
// Live status: runAgentTurn accepts an optional onStatus(text) callback that
// fires as tools execute, so SSE/streaming callers can show "Searching the
// web..." in real time while the turn is still running.

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_URL = `${GROQ_BASE}/chat/completions`;
const MODELS_URL = `${GROQ_BASE}/models`;

// ─── Lazy env getters ─────────────────────────────────────────
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
  s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s;

// Safely fire an onStatus callback without ever letting it break the turn.
const emitStatus = (onStatus, text) => {
  if (typeof onStatus !== "function" || !text) return;
  try {
    onStatus(text);
  } catch {
    /* progress reporting must never kill the request */
  }
};

// ─────────────────────────────────────────────────────────────────────
// TPM budgets — known free-plan defaults, self-corrected from real 413s.
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
// Rough token estimation (chars/4 heuristic — good enough for budgeting,
// not billing). ~4 tokens overhead per message for role/formatting.
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
// Model discovery (cached for the process lifetime)
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
    console.log(`✅ Groq models available to this key: ${_modelCache.join(", ")}`);
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
    console.warn("⚠️ Model discovery failed, using first candidate:", err.message);
    return forced || candidates[0];
  }

  if (forced) {
    if (available.includes(forced)) return forced;
    console.warn(
      `⚠️ "${forced}" from .env is not available to this key — falling back.`
    );
  }

  const match = candidates.find((c) => available.includes(c));
  if (match) return match;

  const generic = available.find(
    (m) =>
      !/whisper|guard|orpheus|tts|embed/i.test(m) && !m.startsWith("groq/compound")
  );
  if (generic) {
    console.warn(`⚠️ No preferred model available, using "${generic}".`);
    return generic;
  }

  throw new Error(
    `No usable chat model on this Groq key. Available: ${available.join(", ") || "none"}`
  );
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
  if (!GROQ_KEY)
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your .env and restart the server."
    );

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
    // Low reasoning effort on JSON-mode calls leaves the model less room to
    // wander before it has to commit to output, which reduces truncated /
    // malformed JSON on small token budgets.
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
    } catch {
      /* keep raw */
    }

    if (res.status === 404) _modelCache = null; // retired model: self-heal
    if (res.status === 413 || res.status === 429) {
      const { limit, namedModel } = parseLimitError(detail);
      if (!namedModel || namedModel === chosenModel) {
        learnTpm(chosenModel, limit);
      }
    }

    const err = new Error(
      `Groq ${res.status} on model "${chosenModel}": ${
        detail?.slice ? detail.slice(0, 500) : detail || res.statusText
      }`
    );
    err.status = res.status;
    err.model = chosenModel;
    err.detail = detail || "";
    // Groq includes the model's raw (invalid) attempt here on json-mode
    // validation failures — surfaced so callers can log/retry intelligently
    // instead of just seeing "adjust your prompt".
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
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("Model did not return valid JSON.");
  }
};

// Groq's own json_object-mode validator can reject a response outright
// (400 "Failed to validate JSON") before it ever reaches us as text — this
// usually means the schema was too complex for the token budget or the
// model wandered off-format. We retry once with a blunter, shorter-form
// instruction and a bumped token budget before giving up.
export async function groqJSON(args) {
  try {
    const raw = await groqText({ ...args, jsonMode: true, tools: undefined });
    return extractJson(raw);
  } catch (err) {
    const isValidationFailure =
      err.status === 400 && /validate json/i.test(err.detail || "");
    const isParseFailure = !err.status; // extractJson threw locally

    if (!isValidationFailure && !isParseFailure) throw err;

    console.warn(
      `⚠️ groqJSON first attempt failed (${
        isValidationFailure ? "Groq validation" : "local parse"
      }) — retrying once with a stricter prompt.`,
      err.failedGeneration ? `Model attempted: ${JSON.stringify(err.failedGeneration).slice(0, 300)}` : ""
    );

    const lastUserMsg = [...args.messages].reverse().find((m) => m.role === "user");
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
// ─────────────────────────────────────────────────────────────────────
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the internet for current information. Returns top results with titles, URLs and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query." },
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
        "Fetch a public website by URL and return its readable text content (scripts/styles stripped).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL." },
        },
        required: ["url"],
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

  const local = [TOOLS.find((t) => t.function.name === "fetch_website")];
  if (process.env.TAVILY_API_KEY && !supportsBuiltIns(model))
    local.unshift(TOOLS.find((t) => t.function.name === "web_search"));
  return [...builtInTools(model), ...local.filter(Boolean)];
};

// ─────────────────────────────────────────────────────────────────────
// Local tool executors
// ─────────────────────────────────────────────────────────────────────
export async function webSearch(query, maxResults = 5) {
  const key = process.env.TAVILY_API_KEY;
  if (!key)
    throw new Error("TAVILY_API_KEY is not set (needed for web search).");

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

  return text.slice(0, 20000);
}

export async function runTool(name, args) {
  switch (name) {
    case "web_search":
      return await webSearch(args.query);
    case "fetch_website":
      return await fetchWebsite(args.url);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Human-readable status text for a tool call.
// Returns null when we don't have anything useful to say.
// ─────────────────────────────────────────────────────────────────────
const statusForToolCall = (call) => {
  const name = call?.function?.name;
  let parsedArgs = {};
  try {
    parsedArgs = JSON.parse(call?.function?.arguments || "{}");
  } catch {
    /* ignore */
  }

  if (name === "web_search") {
    const q = parsedArgs.query;
    return q ? `Searching the web for "${truncate(String(q), 60)}"` : "Searching the web";
  }
  if (name === "fetch_website") {
    return parsedArgs.url ? "Reading the linked page" : "Reading the page";
  }
  return null;
};

// ─────────────────────────────────────────────────────────────────────
// Agentic loop — TPM-budget aware.
//
// `onStatus` (optional): (text: string) => void. Fires as the turn
// progresses so streaming callers can render live status lines like
// "Searching the web…". Never awaited; failures are swallowed.
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

  // Kick off with a generic status so the UI has something to show
  // during the first (potentially slow) model call.
  emitStatus(onStatus, "Thinking");

  let available = [];
  try {
    available = await listAvailableModels();
  } catch {
    /* fall through — pickModel below already warns */
  }
  const preferred = model || (await resolveTextModel());
  const chain = [
    preferred,
    ...TEXT_CANDIDATES.filter(
      (m) => available.includes(m) && m !== preferred && !isCompoundSystem(m)
    ),
    ...HIGH_BUDGET_MODELS.filter((m) => available.includes(m)),
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let lastErr = null;

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
          const budget = tpmFor(attemptModel);
          outputBudget = Math.max(400, Math.floor(outputBudget * 0.6));
          trimmedHistory = trimHistoryToBudget(
            trimmedHistory,
            fixedTokens(),
            budget
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
            console.warn(
              `⚠️ "${attemptModel}" rate limited, waiting ${Math.round(
                waitMs / 1000
              )}s before retry...`
            );
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
        if (content) return { content, model: attemptModel, executed };

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

        // Emit a status line based on which tool is firing
        const statusText = statusForToolCall(call);
        if (statusText) emitStatus(onStatus, statusText);

        try {
          const args = JSON.parse(call.function?.arguments || "{}");
          result = await runTool(call.function.name, args);
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
      }) — trying next model.`
    );
  }

  throw (
    lastErr ||
    new Error("No Groq model in the fallback chain could handle this request.")
  );
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