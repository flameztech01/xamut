// controllers/aiController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

import Conversation from "../models/conversationModel.js";
import Document from "../models/documentModel.js";
import ClipJob from "../models/clipJobModel.js";
import {
  groqText,
  groqJSON,
  groqVision,
  runAgentTurn,
  webSearch,
  fetchWebsite,
  getTextModel,
  getVisionModel,
  resolveVisionModel,
} from "../utils/xamutAI.js";
import { processClipJob } from "../utils/groqClipper.js";

// ─────────────────────────────────────────────────────────────────────
// Optional packages
// ─────────────────────────────────────────────────────────────────────
let mammoth, pdfParse;
try { mammoth = (await import("mammoth")).default; } catch { mammoth = null; }
try { pdfParse = (await import("pdf-parse")).default; } catch { pdfParse = null; }

// ─────────────────────────────────────────────────────────────────────
// Agent personas
// ─────────────────────────────────────────────────────────────────────
const BASE_RULES = `
You are Xamut, an AI assistant built for students. Be clear, friendly, and accurate.
- Prefer short paragraphs and bullet lists over walls of text.
- When a question needs current info (news, prices, live data, "latest", or anything that may have changed since your training), search the web before answering rather than guessing.
- When the user provides a URL, fetch it and then summarize in your own words.
- Never fabricate citations or sources. If you looked something up, say so and name the source.
- If a request is academic, help the student understand and write in their own voice — do not just hand over a finished essay without explanation.
`;

const AGENTS = {
  chat: `${BASE_RULES}\nYou are in general chat mode. Answer anything.`,
  coding: `${BASE_RULES}
You are Xamut Code — a coding tutor and pair programmer.
- Explain the approach briefly, then show code, then explain the tricky parts.
- Prefer readable, idiomatic code. Call out edge cases.
- Ask a clarifying question if the task or language is ambiguous.`,
  assignment: `${BASE_RULES}
You are Xamut Scholar — an academic writing and research assistant.
- Help structure assignments, reports, and projects with clear sections.
- Suggest an outline before drafting long text.
- Cite web sources you actually retrieved when you search.
- Encourage the student to review and personalise the work.`,
  research: `${BASE_RULES}
You are Xamut Research — a deep research assistant.
- Always start by searching the web on the topic.
- Read the most promising 1–3 sources in full before summarizing.
- Produce a well-organised brief with headings and a source list.`,
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const makeTitle = (text = "") => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
};

const stripControl = (s = "") => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();

const toHistory = (messages, limit = 20) =>
  messages
    .slice(-limit)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content || "" }));

const uploadBuffer = (buffer, folder, publicId, resourceType = "image") =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });

// ─────────────────────────────────────────────────────────────────────
// Colors + templates
// ─────────────────────────────────────────────────────────────────────
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

const COLOR_WORDS = {
  green: "2E7D32", white: "FFFFFF", blue: "1565C0", red: "C62828",
  black: "111111", gold: "C9A227", yellow: "F9A825", purple: "6A1B9A",
  orange: "E65100", teal: "00695C", navy: "0D1B2A", gray: "616161",
  grey: "616161", dark: "1B2B1E", pink: "AD1457", brown: "5D4037",
  cream: "F5F1E8", cream2: "EFE7D3", sky: "38BDF8", emerald: "059669",
  slate: "1E293B", rose: "E11D48", amber: "F59E0B",
};

const normalizeColor = (val, fallback) => {
  if (!val) return fallback;
  const v = String(val).trim().toLowerCase();
  if (COLOR_WORDS[v]) return COLOR_WORDS[v];
  const asHex = v.replace("#", "");
  if (HEX_RE.test(asHex)) return asHex.toUpperCase();
  return fallback;
};

const TEMPLATES = {
  // ── Presentations ──
  "modern-green":  { type: "presentation", primary: "2E7D32", secondary: "FFFFFF", accent: "C9A227", dark: "1B2B1E" },
  "corporate-blue":{ type: "presentation", primary: "1565C0", secondary: "FFFFFF", accent: "0D47A1", dark: "0A1E3A" },
  "bold-orange":   { type: "presentation", primary: "E65100", secondary: "FFF7ED", accent: "111827", dark: "1A0F05" },
  "elegant-navy":  { type: "presentation", primary: "0D1B2A", secondary: "F4F1EA", accent: "C9A227", dark: "0D1B2A" },
  "minimal-mono":  { type: "presentation", primary: "111111", secondary: "FFFFFF", accent: "6B7280", dark: "111111" },
  "sunset-purple": { type: "presentation", primary: "6A1B9A", secondary: "FBF5FF", accent: "E11D48", dark: "2A0A3D" },
  "ocean-teal":    { type: "presentation", primary: "00695C", secondary: "F0FDFA", accent: "F59E0B", dark: "042F2E" },
  "royal-gold":    { type: "presentation", primary: "1E293B", secondary: "F8FAFC", accent: "C9A227", dark: "0F172A" },
  // ── Documents ──
  "formal-academic": { type: "document", primary: "2E7D32", secondary: "FFFFFF", accent: "6B7280", dark: "1A1A1A" },
  "corporate-report":{ type: "document", primary: "1565C0", secondary: "FFFFFF", accent: "0D47A1", dark: "0A1E3A" },
  "warm-cream":      { type: "document", primary: "5D4037", secondary: "F5F1E8", accent: "C9A227", dark: "2A1E14" },
  "minimal-slate":   { type: "document", primary: "1E293B", secondary: "FFFFFF", accent: "64748B", dark: "0F172A" },
  "elegant-serif":   { type: "document", primary: "111111", secondary: "F8F5EF", accent: "8B7355", dark: "111111" },
  "fresh-emerald":   { type: "document", primary: "059669", secondary: "F0FDF4", accent: "111827", dark: "052E1A" },
};

const pickTemplateId = (type, explicitId) => {
  if (explicitId && TEMPLATES[explicitId] && TEMPLATES[explicitId].type === type) {
    return explicitId;
  }
  return (
    Object.keys(TEMPLATES).find((k) => TEMPLATES[k].type === type) ||
    (type === "presentation" ? "modern-green" : "formal-academic")
  );
};

function resolveTheme({ type, templateId, primaryColor, secondaryColor }) {
  const id = pickTemplateId(type, templateId);
  const base = TEMPLATES[id];

  const primary = primaryColor
    ? normalizeColor(primaryColor, base.primary)
    : base.primary;
  const secondary = secondaryColor
    ? normalizeColor(secondaryColor, base.secondary)
    : base.secondary;

  return {
    templateId: id,
    primaryColor: primary,
    secondaryColor: secondary,
    accentColor: base.accent,
    textColor: base.dark,
    backgroundColor: base.secondary,
    fontFamily: "Calibri",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Markdown guardrail
// ─────────────────────────────────────────────────────────────────────
const MARKDOWN_RULES = `Formatting: you may use **bold** around key terms or phrases for emphasis, and *italics* for secondary emphasis — use both sparingly, not on every sentence. Do NOT use any other markdown: no headers (#), no code fences, no links, no tables, no nested lists.`;

// ─────────────────────────────────────────────────────────────────────
// CONTENT GENERATORS (documents + presentations)
//
// Both accept an optional `onStatus(text)` callback so streaming callers
// can surface per-section / per-slide progress in the UI.
// ─────────────────────────────────────────────────────────────────────
const DOC_SECTION_COUNTS = { short: 3, medium: 5, long: 8 };
const DOC_TARGET_WORDS = { short: 400, medium: 900, long: 1800 };

async function generateDocumentContent({
  userId,
  conversationId,
  topic,
  instructions = "",
  style = "academic",
  length = "medium",
  templateId,
  primaryColor,
  secondaryColor,
  sourcePrompt = "",
  onStatus,
}) {
  const report = typeof onStatus === "function" ? onStatus : () => {};

  const targetWords = DOC_TARGET_WORDS[length] || DOC_TARGET_WORDS.medium;
  const sectionCount = DOC_SECTION_COUNTS[length] || DOC_SECTION_COUNTS.medium;
  const wordsPerSection = Math.round(targetWords / sectionCount);

  report("Planning the document outline");

  const outline = await groqJSON({
    messages: [
      { role: "system", content: "You are a document architect. Return STRICT JSON only." },
      {
        role: "user",
        content: `Plan a ${style} document about: ${topic}.
Extra instructions: ${instructions || "none"}
Produce exactly ${sectionCount} sections.
Do NOT treat this as a presentation or slide deck — it is a written prose document.

Return JSON with this exact shape:
{
  "title": "string",
  "subtitle": "string (optional)",
  "sections": [
    { "heading": "string", "brief": "one sentence describing what this section should cover" }
  ]
}
No markdown, no code fences, no commentary.`,
      },
    ],
    temperature: 0.6,
    maxTokens: 700,
  });

  const pages = [];

  pages.push({
    role: "cover",
    heading: outline.title || topic,
    subheading: outline.subtitle || "",
    paragraphs: [],
    bullets: [],
    notes: "",
  });

  const sections = outline.sections || [];
  for (let idx = 0; idx < sections.length; idx++) {
    const s = sections[idx];
    report(`Writing section ${idx + 1} of ${sections.length}`);

    const body = await groqJSON({
      messages: [
        { role: "system", content: "You write one section of a document at a time. Return STRICT JSON only." },
        {
          role: "user",
          content: `Document topic: ${topic}
Section heading: ${s.heading}
What this section should cover: ${s.brief || ""}
Target length: about ${wordsPerSection} words.
Style: ${style}

Write flowing prose paragraphs — this is a written document, NOT a slide deck. Do not return bullet points unless the content is genuinely a list.
${MARKDOWN_RULES}

Return JSON with this exact shape:
{ "paragraphs": ["string", "..."], "bullets": ["string", "..."] }
"bullets" can be an empty array. Aside from the bold/italic markers described above, no markdown, no commentary.`,
        },
      ],
      temperature: 0.6,
      maxTokens: 1100,
    });

    pages.push({
      role: "section",
      heading: s.heading,
      subheading: "",
      paragraphs: body.paragraphs || [],
      bullets: body.bullets || [],
      notes: "",
    });
  }

  report("Assembling the document");

  const theme = resolveTheme({
    type: "document",
    templateId,
    primaryColor,
    secondaryColor,
  });

  const doc = await Document.create({
    user: userId,
    conversation: conversationId || null,
    type: "document",
    title: outline.title || topic,
    subtitle: outline.subtitle || "",
    author: "Xamut",
    pages,
    theme,
    sourcePrompt,
    status: "ready",
  });

  return doc;
}

async function generatePresentationContent({
  userId,
  conversationId,
  topic,
  instructions = "",
  slides = 10,
  companyName = "",
  templateId,
  primaryColor,
  secondaryColor,
  sourcePrompt = "",
  onStatus,
}) {
  const report = typeof onStatus === "function" ? onStatus : () => {};

  const count = Math.min(Math.max(Number(slides) || 10, 4), 25);

  report("Planning the slide structure");

  const outline = await groqJSON({
    messages: [
      { role: "system", content: "You are a presentation architect. Return STRICT JSON only." },
      {
        role: "user",
        content: `Plan a ${count}-slide presentation about: ${topic}.
Extra instructions: ${instructions || "none"}
This IS a slide deck — bullets, short points, spoken-word notes.

Return JSON exactly:
{
  "title": "string",
  "subtitle": "string",
  "slides": [
    { "title": "string", "brief": "one sentence on what this slide should cover" }
  ]
}
Produce exactly ${count} entries in "slides". No markdown, no code fences, no commentary.`,
      },
    ],
    temperature: 0.6,
    maxTokens: 700,
  });

  const pages = [];

  pages.push({
    role: "cover",
    heading: outline.title || topic,
    subheading: outline.subtitle || "",
    paragraphs: [],
    bullets: [],
    notes: "",
  });

  const slideList = outline.slides || [];
  for (let idx = 0; idx < slideList.length; idx++) {
    const s = slideList[idx];
    report(`Writing slide ${idx + 1} of ${slideList.length}`);

    const body = await groqJSON({
      messages: [
        { role: "system", content: "You write the content for one slide at a time. Return STRICT JSON only." },
        {
          role: "user",
          content: `Presentation topic: ${topic}
Slide title: ${s.title}
What this slide should cover: ${s.brief || ""}
${MARKDOWN_RULES}

Return JSON exactly:
{ "bullets": ["string", "..."], "notes": "string (speaker notes, 1-2 sentences)" }
3-5 short, punchy bullets. Aside from the bold/italic markers described above, no markdown, no commentary.`,
        },
      ],
      temperature: 0.6,
      maxTokens: 500,
    });

    pages.push({
      role: "content",
      heading: s.title,
      subheading: "",
      paragraphs: [],
      bullets: body.bullets || [],
      notes: body.notes || "",
    });
  }

  pages.push({
    role: "closing",
    heading: "Thank You",
    subheading: companyName || outline.title || topic,
    paragraphs: [],
    bullets: [],
    notes: "",
  });

  report("Assembling the presentation");

  const theme = resolveTheme({
    type: "presentation",
    templateId,
    primaryColor,
    secondaryColor,
  });

  const doc = await Document.create({
    user: userId,
    conversation: conversationId || null,
    type: "presentation",
    title: outline.title || topic,
    subtitle: outline.subtitle || "",
    author: "Xamut",
    companyName: companyName || "",
    pages,
    theme,
    sourcePrompt,
    status: "ready",
  });

  return doc;
}

// ─────────────────────────────────────────────────────────────────────
// CLIP JOB RUNNER
// ─────────────────────────────────────────────────────────────────────
async function runClipPipeline(job) {
  try {
    const result = await processClipJob({
      url: job.sourceUrl,
      userPrompt: job.prompt,
      clipCount: job.requestedClips,
      aspectRatio: job.aspectRatio,
      onProgress: async (stage) => {
        job.status = stage;
        await job.save().catch(() => {});
      },
    });

    job.transcript = result.transcript || "";
    job.transcriptSegments = result.segments || [];
    job.clips = result.clips || [];
    job.status = "ready";

    if (job.clips.length) {
      try {
        job.summary = await groqText({
          messages: [
            {
              role: "system",
              content:
                "You write short editorial notes about a set of video clips. One or two sentences. Note which look most viral-worthy and why.",
            },
            {
              role: "user",
              content: JSON.stringify(
                job.clips.map((c) => ({
                  title: c.title,
                  hook: c.hook,
                  score: c.viralityScore,
                }))
              ),
            },
          ],
          temperature: 0.5,
          maxTokens: 400,
        });
      } catch {
        job.summary = "";
      }
    }

    await job.save();
  } catch (err) {
    console.error("❌ Clip pipeline failed:", err.message);
    job.status = "failed";
    job.failureReason = err.message;
    await job.save().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────
// Chat-side intent detection
// ─────────────────────────────────────────────────────────────────────
async function detectGenerationIntent({ message, history, forceType = null }) {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  let result;
  try {
    result = await groqJSON({
      messages: [
        {
          role: "system",
          content: `You classify a user message to decide if they want an AI-generated deliverable RIGHT NOW.

Three possible deliverables:

1. type = "document" — an essay, report, chapter, thesis, dissertation, paper, assignment, letter, article, proposal, memo, brief, notes, summary, study guide, literature review, analysis, write-up, or ANY prose deliverable that reads as pages.

2. type = "presentation" — a slide deck, slides, slideshow, pitch deck, keynote, or PPT.

3. type = "clips" — the user wants to clip / cut / extract highlights from a video URL (YouTube, direct MP4, or any public video link). Signal words: clip, clips, highlights, moments, extract from, cut this video, viral moments, shorts from, repurpose this video.

STRICT CLASSIFICATION RULES:

Signal words → type = "document":
  chapter, chapters, essay, report, thesis, dissertation, paper, assignment,
  letter, article, proposal, memo, brief, notes, summary, guide, review,
  analysis, write-up, research, "write me", "write a", "draft a", "compose"

Signal words → type = "presentation":
  slide, slides, slideshow, deck, pitch deck, keynote, PPT, powerpoint,
  "presentation", "present to", "presentation on", "make slides"

Signal words → type = "clips":
  clip, clips, highlight, highlights, moments, "cut this", "extract from",
  "shorts from", "viral moments", "repurpose this video"

Rules:
- NEVER set type = "presentation" unless the user explicitly said one of the presentation words.
- NEVER set type = "clips" unless a video URL is present OR one of the clip signal words is present AND a URL is in the message.
- If NEITHER of the above and no URL is present:
  - Academic / school / essay topic → type = "document"
  - Business pitch / talk → type = "presentation"
  - Anything else → type = "document"

For type = "clips", the sourceUrl MUST be the video URL from the message. If no URL is present, set wantsGeneration = false.

If there is no clear topic in the message for document/presentation, set wantsGeneration = false.
If the user is just chatting about a topic (not asking to be given a deliverable), set wantsGeneration = false.

Return STRICT JSON only.`,
        },
        {
          role: "user",
          content: `Recent conversation:
${recent || "(none)"}

Latest user message:
${message}

Return JSON exactly:
{
  "wantsGeneration": boolean,
  "type": "document" | "presentation" | "clips" | null,
  "readyToGenerate": boolean,
  "topic": "string or null",
  "sourceUrl": "string or null",
  "companyName": "string or null",
  "instructions": "string or null",
  "style": "string or null",
  "length": "short" | "medium" | "long" | null,
  "slideCount": number or null,
  "clipCount": number or null,
  "aspectRatio": "portrait" | "landscape" | null,
  "templateId": "string or null",
  "primaryColor": "string or null",
  "secondaryColor": "string or null"
}

No markdown, no commentary.`,
        },
      ],
      temperature: 0,
      maxTokens: 500,
    });
  } catch (err) {
    console.warn(
      "⚠️ Generation intent detection failed, falling back to chat:",
      err.message
    );
    return { wantsGeneration: false, type: null, readyToGenerate: false };
  }

  if (
    forceType === "document" ||
    forceType === "presentation" ||
    forceType === "clips"
  ) {
    result.type = forceType;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Shared turn engine
//
// Both /chat and /chat/stream call this. The only difference is that
// /chat/stream passes an onStatus callback, which propagates into
// runAgentTurn, the generators, and clip setup.
//
// Returns { reply, usedModel, replyAttachments, convo, trimmed }.
// Throws on any AI failure — the caller decides how to respond.
// ─────────────────────────────────────────────────────────────────────
async function executeChatTurn({
  user,
  conversationId,
  message,
  agent,
  attachments,
  context,
  forceType,
  onStatus,
}) {
  const report = typeof onStatus === "function" ? onStatus : () => {};

  const trimmed = (message || "").trim();

  let convo;
  let isNewConversation = false;

  if (conversationId) {
    if (!isObjectId(conversationId)) {
      const err = new Error("Invalid conversationId.");
      err.statusCode = 400;
      throw err;
    }
    convo = await Conversation.findOne({
      _id: conversationId,
      user: user._id,
    });
    if (!convo) {
      const err = new Error("Conversation not found.");
      err.statusCode = 404;
      throw err;
    }
  } else {
    isNewConversation = true;
    convo = await Conversation.create({
      user: user._id,
      title: makeTitle(trimmed || "New chat"),
      agent,
      context: context || "",
    });
  }

  if (conversationId && agent && convo.agent !== agent) convo.agent = agent;

  const cleanAttachments = (attachments || []).map((a) => ({
    type: a.type,
    url: a.url || "",
    name: a.name || "",
    mimeType: a.mimeType || "",
    extractedText: (a.extractedText || "").slice(0, 30000),
  }));

  convo.messages.push({
    role: "user",
    content: trimmed,
    attachments: cleanAttachments,
  });

  const systemPrompt = [
    AGENTS[agent],
    convo.customInstructions
      ? `\nCustom instructions:\n${convo.customInstructions}`
      : "",
    convo.context ? `\nUser context:\n${convo.context}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const history = toHistory(convo.messages.slice(0, -1), 20);

  const images = cleanAttachments.filter((a) => a.type === "image");
  const docs = cleanAttachments.filter(
    (a) => a.type === "document" && a.extractedText
  );

  let effectiveText = trimmed;
  if (docs.length) {
    const docBlock = docs
      .map(
        (d, i) =>
          `--- Attached document ${i + 1}: ${
            d.name || "document"
          } ---\n${d.extractedText}`
      )
      .join("\n\n");
    effectiveText = `${docBlock}\n\nUser question:\n${
      trimmed || "(summarize the document)"
    }`;
  }

  let reply;
  let usedModel = getTextModel();
  const replyAttachments = [];

  try {
    // ── Intent detection ────────────────────────────────────
    let intent = { wantsGeneration: false };
    if (!images.length && !docs.length && trimmed) {
      report("Understanding your request");
      intent = await detectGenerationIntent({
        message: trimmed,
        history,
        forceType: forceType || null,
      });
    }

    // ── Clips ───────────────────────────────────────────────
    if (
      intent.wantsGeneration &&
      intent.type === "clips" &&
      intent.sourceUrl
    ) {
      report("Setting up the clipping job");

      const job = await ClipJob.create({
        user: user._id,
        conversation: convo._id,
        sourceUrl: intent.sourceUrl,
        prompt: (intent.instructions || "").slice(0, 500),
        provider: "groq",
        requestedClips: Math.min(
          Math.max(Number(intent.clipCount) || 7, 1),
          10
        ),
        aspectRatio:
          intent.aspectRatio === "landscape" ? "landscape" : "portrait",
        status: "downloading",
      });

      runClipPipeline(job);

      replyAttachments.push({
        type: "clip-job",
        jobId: String(job._id),
        provider: "groq",
        sourceUrl: job.sourceUrl,
        requestedClips: job.requestedClips,
        status: "downloading",
      });

      reply = `Scanning that video for highlights now. I'll deliver up to **${job.requestedClips} clips**. Open the job to watch progress.`;
      usedModel = "xamut-clipper";
    }

    // ── Documents / presentations ───────────────────────────
    if (
      !reply &&
      intent.wantsGeneration &&
      intent.readyToGenerate &&
      intent.topic
    ) {
      if (intent.type === "presentation") {
        const built = await generatePresentationContent({
          userId: user._id,
          conversationId: convo._id,
          topic: intent.topic,
          instructions: intent.instructions || "",
          slides: intent.slideCount || 10,
          companyName: intent.companyName || "",
          templateId: intent.templateId || undefined,
          primaryColor: intent.primaryColor || undefined,
          secondaryColor: intent.secondaryColor || undefined,
          sourcePrompt: trimmed,
          onStatus: report,
        });

        replyAttachments.push({
          type: "generated-document",
          documentId: String(built._id),
          documentType: "presentation",
          title: built.title,
          pageCount: built.pages.length,
          templateId: built.theme.templateId,
        });

        reply = `Your presentation is ready: **${built.title}** (${built.pages.length} slides). Open it to preview and download.`;
        usedModel = "xamut-writer";
      } else if (intent.type === "document") {
        const built = await generateDocumentContent({
          userId: user._id,
          conversationId: convo._id,
          topic: intent.topic,
          instructions: intent.instructions || "",
          style: intent.style || "academic",
          length: intent.length || "medium",
          templateId: intent.templateId || undefined,
          primaryColor: intent.primaryColor || undefined,
          secondaryColor: intent.secondaryColor || undefined,
          sourcePrompt: trimmed,
          onStatus: report,
        });

        replyAttachments.push({
          type: "generated-document",
          documentId: String(built._id),
          documentType: "document",
          title: built.title,
          pageCount: built.pages.length,
          templateId: built.theme.templateId,
        });

        reply = `Your document is ready: **${built.title}**. Open it to preview and download.`;
        usedModel = "xamut-writer";
      }
    }

    // ── Vision / normal chat ────────────────────────────────
    if (!reply) {
      if (images.length) {
        report("Analyzing the image");

        const visionReplies = [];
        for (const img of images) {
          const v = await groqVision({
            system: systemPrompt,
            prompt: effectiveText || "Describe this image in detail.",
            imageUrl: img.url,
          });
          visionReplies.push(v);
        }
        reply = visionReplies.join("\n\n");
        usedModel = await resolveVisionModel();

        if (trimmed && reply) {
          const refine = await runAgentTurn({
            systemPrompt,
            history,
            userContent: `User question: ${trimmed}\n\nWhat you saw in the image(s):\n${reply}\n\nGive the final answer.`,
            onStatus: report,
          });
          reply = refine.content || reply;
          usedModel = refine.model;
        }
      } else {
        const turn = await runAgentTurn({
          systemPrompt,
          history,
          userContent: effectiveText || "(no message)",
          onStatus: report,
        });
        reply = turn.content;
        usedModel = turn.model;
      }
    }
  } catch (aiErr) {
    if (isNewConversation) {
      await Conversation.deleteOne({ _id: convo._id }).catch(() => {});
    }
    throw aiErr;
  }

  convo.messages.push({
    role: "assistant",
    content:
      reply || "I couldn't come up with a reply for that — try rephrasing?",
    model: usedModel,
    attachments: replyAttachments,
  });
  convo.lastMessageAt = new Date();
  if (convo.messages.length <= 2 && convo.title === "New chat") {
    convo.title = makeTitle(trimmed || "New chat");
  }
  await convo.save();

  const saved = convo.messages[convo.messages.length - 1];

  return {
    conversationId: convo._id,
    title: convo.title,
    agent: convo.agent,
    reply: {
      _id: saved._id,
      role: "assistant",
      content: saved.content,
      model: saved.model,
      attachments: saved.attachments || [],
      createdAt: saved.createdAt,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// POST /api/ai/upload
// ─────────────────────────────────────────────────────────────────────
export const uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file uploaded (field name should be 'file').");
  }

  const file = req.file;
  const mime = file.mimetype || "";
  const origName = file.originalname || "file";
  const ext = path.extname(origName).toLowerCase();
  const buffer = file.buffer;

  if (!buffer) {
    res.status(500);
    throw new Error("Upload buffer missing — make sure this route uses multer.memoryStorage().");
  }

  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf" || ext === ".pdf";
  const isDocx =
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx";
  const isTxt = mime === "text/plain" || ext === ".txt";

  if (!isImage && !isPdf && !isDocx && !isTxt) {
    res.status(400);
    throw new Error("Unsupported file type. Use image, PDF, DOCX or TXT.");
  }

  let extractedText = "";
  try {
    if (isPdf) {
      if (!pdfParse) throw new Error("pdf-parse is not installed.");
      const parsed = await pdfParse(buffer);
      extractedText = stripControl(parsed.text || "");
    } else if (isDocx) {
      if (!mammoth) throw new Error("mammoth is not installed.");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = stripControl(result.value || "");
    } else if (isTxt) {
      extractedText = stripControl(buffer.toString("utf8"));
    }
  } catch (parseErr) {
    console.error("⚠️ Text extraction failed:", parseErr.message);
    extractedText = "";
  }

  const resourceType = isImage ? "image" : "raw";
  const folder = isImage ? "xamut/ai/images" : "xamut/ai/docs";
  const publicId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const uploaded = await uploadBuffer(buffer, folder, publicId, resourceType);

  res.status(200).json({
    success: true,
    attachment: {
      type: isImage ? "image" : "document",
      url: uploaded.secure_url,
      name: origName,
      mimeType: mime,
      extractedText: extractedText.slice(0, 30000),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/ai/upload/image
// ─────────────────────────────────────────────────────────────────────
export const uploadImageAttachment = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No image uploaded (field name should be 'file').");
  }
  res.status(200).json({
    success: true,
    attachment: {
      type: "image",
      url: req.file.path || req.file.secure_url || "",
      name: req.file.originalname || "image",
      mimeType: req.file.mimetype || "",
      extractedText: "",
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/ai/chat
//
// Classic non-streaming endpoint. Kept for compatibility and for direct
// API consumers. The Chat UI uses /chat/stream instead.
// ─────────────────────────────────────────────────────────────────────
export const sendMessage = asyncHandler(async (req, res) => {
  const {
    conversationId,
    message = "",
    agent = "chat",
    attachments = [],
    context,
    forceType,
  } = req.body;

  const trimmed = (message || "").trim();
  if (!trimmed && !(attachments?.length)) {
    res.status(400);
    throw new Error("Message or attachment is required.");
  }
  if (!AGENTS[agent]) {
    res.status(400);
    throw new Error(`Unknown agent "${agent}".`);
  }

  try {
    const result = await executeChatTurn({
      user: req.user,
      conversationId,
      message,
      agent,
      attachments,
      context,
      forceType,
    });

    res.status(200).json({
      success: true,
      conversationId: result.conversationId,
      title: result.title,
      agent: result.agent,
      reply: result.reply,
    });
  } catch (err) {
    console.error("❌ AI turn failed:", err.message);
    res.status(err.statusCode || 502);
    throw new Error(err.message || "The AI provider request failed.");
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/ai/chat/stream
//
// Same routing as /chat, but pushes Server-Sent Events as the turn runs:
//
//   { type: "status", text: "Searching the web for '...'" }
//   { type: "done",   conversationId, title, agent, reply }
//   { type: "error",  message }
//
// The client keeps the connection open and renders each status line as it
// arrives, so the user sees progress instead of a blank "Thinking…".
// ─────────────────────────────────────────────────────────────────────
export const sendMessageStream = async (req, res) => {
  // ─── SSE headers ────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable proxy buffering (nginx, Cloudflare) so events flush immediately
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const write = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client disconnected — nothing we can do */
    }
  };

  const emitStatus = (text) => {
    if (text) write({ type: "status", text });
  };

  // Heartbeat — keeps idle proxies from killing the connection
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 15000);

  const cleanup = () => clearInterval(heartbeat);

  try {
    const {
      conversationId,
      message = "",
      agent = "chat",
      attachments = [],
      context,
      forceType,
    } = req.body;

    const trimmed = (message || "").trim();
    if (!trimmed && !(attachments?.length)) {
      write({ type: "error", message: "Message or attachment is required." });
      cleanup();
      return res.end();
    }
    if (!AGENTS[agent]) {
      write({ type: "error", message: `Unknown agent "${agent}".` });
      cleanup();
      return res.end();
    }

    const result = await executeChatTurn({
      user: req.user,
      conversationId,
      message,
      agent,
      attachments,
      context,
      forceType,
      onStatus: emitStatus,
    });

    write({
      type: "done",
      conversationId: result.conversationId,
      title: result.title,
      agent: result.agent,
      reply: result.reply,
    });
  } catch (err) {
    console.error("❌ Stream turn failed:", err.message);
    write({
      type: "error",
      message: err.message || "The AI provider request failed.",
    });
  } finally {
    cleanup();
    res.end();
  }
};

// ─────────────────────────────────────────────────────────────────────
// Conversations CRUD
// ─────────────────────────────────────────────────────────────────────
export const listConversations = asyncHandler(async (req, res) => {
  const list = await Conversation.find({ user: req.user._id, isArchived: false })
    .select("title agent lastMessageAt createdAt updatedAt messages")
    .sort({ lastMessageAt: -1 })
    .lean();

  const summary = list.map((c) => {
    const last = c.messages?.[c.messages.length - 1];
    return {
      _id: c._id,
      title: c.title,
      agent: c.agent,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      messageCount: c.messages?.length || 0,
      preview: last?.content?.slice(0, 120) || "",
    };
  });

  res.status(200).json({ success: true, conversations: summary });
});

export const getConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid conversation id.");
  }
  const convo = await Conversation.findOne({ _id: id, user: req.user._id });
  if (!convo) {
    res.status(404);
    throw new Error("Conversation not found.");
  }
  res.status(200).json({ success: true, conversation: convo });
});

export const createConversation = asyncHandler(async (req, res) => {
  const { title, agent = "chat", customInstructions = "", context = "" } = req.body || {};
  if (!AGENTS[agent]) {
    res.status(400);
    throw new Error(`Unknown agent "${agent}".`);
  }
  const convo = await Conversation.create({
    user: req.user._id,
    title: title?.trim() || "New chat",
    agent,
    customInstructions,
    context,
  });
  res.status(201).json({ success: true, conversation: convo });
});

export const updateConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, customInstructions, context, agent, isArchived } = req.body || {};

  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid conversation id.");
  }

  const convo = await Conversation.findOne({ _id: id, user: req.user._id });
  if (!convo) {
    res.status(404);
    throw new Error("Conversation not found.");
  }

  if (typeof title === "string") convo.title = title.trim().slice(0, 120);
  if (typeof customInstructions === "string") convo.customInstructions = customInstructions.slice(0, 8000);
  if (typeof context === "string") convo.context = context.slice(0, 4000);
  if (agent && AGENTS[agent]) convo.agent = agent;
  if (typeof isArchived === "boolean") convo.isArchived = isArchived;

  await convo.save();
  res.status(200).json({ success: true, conversation: convo });
});

export const deleteConversation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid conversation id.");
  }
  const deleted = await Conversation.findOneAndDelete({ _id: id, user: req.user._id });
  if (!deleted) {
    res.status(404);
    throw new Error("Conversation not found.");
  }
  res.status(200).json({ success: true, message: "Conversation deleted." });
});

// ─────────────────────────────────────────────────────────────────────
// Direct tools
// ─────────────────────────────────────────────────────────────────────
export const searchWeb = asyncHandler(async (req, res) => {
  const { query } = req.body || {};
  if (!query?.trim()) {
    res.status(400);
    throw new Error("query is required.");
  }
  const result = await webSearch(query.trim());
  res.status(200).json({ success: true, query, ...result });
});

export const analyzeWebsite = asyncHandler(async (req, res) => {
  const { url, question = "Summarize this page for a student." } = req.body || {};
  if (!url?.trim()) {
    res.status(400);
    throw new Error("url is required.");
  }
  const content = await fetchWebsite(url.trim());
  const summary = await groqText({
    messages: [
      {
        role: "system",
        content:
          "You analyze web pages for students. Summarize clearly: what the page is about, key points, and anything actionable. Be concise.",
      },
      { role: "user", content: `URL: ${url}\n\nQuestion: ${question}\n\nPage content:\n${content}` },
    ],
    temperature: 0.3,
    maxTokens: 900,
  });
  res.status(200).json({ success: true, url, summary });
});

export const analyzeImage = asyncHandler(async (req, res) => {
  const { imageUrl, question = "Describe this image in detail." } = req.body || {};
  if (!imageUrl?.trim()) {
    res.status(400);
    throw new Error("imageUrl is required.");
  }
  const analysis = await groqVision({
    system: "You analyze images for students: describe what you see, read any visible text, and answer the question directly.",
    prompt: question,
    imageUrl: imageUrl.trim(),
  });
  res.status(200).json({ success: true, analysis });
});

// ─────────────────────────────────────────────────────────────────────
// Direct generators (documents + presentations)
// ─────────────────────────────────────────────────────────────────────
export const generateDocument = asyncHandler(async (req, res) => {
  const { topic, instructions, style, length, templateId, primaryColor, secondaryColor } = req.body || {};
  if (!topic?.trim()) {
    res.status(400);
    throw new Error("topic is required.");
  }
  const doc = await generateDocumentContent({
    userId: req.user._id,
    conversationId: null,
    topic,
    instructions,
    style,
    length,
    templateId,
    primaryColor,
    secondaryColor,
    sourcePrompt: topic,
  });
  res.status(201).json({ success: true, document: doc.toSummary() });
});

export const generatePresentation = asyncHandler(async (req, res) => {
  const { topic, instructions, slides, companyName, templateId, primaryColor, secondaryColor } = req.body || {};
  if (!topic?.trim()) {
    res.status(400);
    throw new Error("topic is required.");
  }
  const doc = await generatePresentationContent({
    userId: req.user._id,
    conversationId: null,
    topic,
    instructions,
    slides,
    companyName,
    templateId,
    primaryColor,
    secondaryColor,
    sourcePrompt: topic,
  });
  res.status(201).json({ success: true, document: doc.toSummary() });
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/ai/clips
// ─────────────────────────────────────────────────────────────────────
export const startClipJobController = asyncHandler(async (req, res) => {
  const {
    sourceUrl,
    prompt = "",
    clips = 7,
    aspectRatio = "portrait",
    conversationId,
  } = req.body || {};

  if (!sourceUrl?.trim()) {
    res.status(400);
    throw new Error("sourceUrl is required.");
  }

  const job = await ClipJob.create({
    user: req.user._id,
    conversation: conversationId || null,
    sourceUrl: sourceUrl.trim(),
    prompt: String(prompt).slice(0, 500),
    provider: "groq",
    requestedClips: Math.min(Math.max(Number(clips) || 7, 1), 10),
    aspectRatio: aspectRatio === "landscape" ? "landscape" : "portrait",
    status: "downloading",
  });

  runClipPipeline(job);

  res.status(202).json({
    success: true,
    jobId: job._id,
    status: job.status,
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/ai/clips/:id
// ─────────────────────────────────────────────────────────────────────
export const getClipJobStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid job id.");
  }

  const record = await ClipJob.findOne({ _id: id, user: req.user._id });
  if (!record) {
    res.status(404);
    throw new Error("Clip job not found.");
  }

  res.status(200).json({ success: true, result: record });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/ai/clips
// ─────────────────────────────────────────────────────────────────────
export const listClipJobs = asyncHandler(async (req, res) => {
  const jobs = await ClipJob.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.status(200).json({
    success: true,
    jobs: jobs.map((j) => ({
      _id: j._id,
      sourceUrl: j.sourceUrl,
      provider: j.provider,
      status: j.status,
      clipCount: j.clips?.length || 0,
      requestedClips: j.requestedClips,
      createdAt: j.createdAt,
    })),
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/ai/models — diagnostics
// ─────────────────────────────────────────────────────────────────────
export const getResolvedModels = asyncHandler(async (req, res) => {
  const { resolveTextModel } = await import("../utils/xamutAI.js");
  const [text, vision] = await Promise.all([resolveTextModel(), resolveVisionModel()]);
  res.status(200).json({ success: true, textModel: text, visionModel: vision });
});

// ─────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────
export default {
  uploadAttachment,
  uploadImageAttachment,
  sendMessage,
  sendMessageStream,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  searchWeb,
  analyzeWebsite,
  analyzeImage,
  generateDocument,
  generatePresentation,
  startClipJobController,
  getClipJobStatus,
  listClipJobs,
  getResolvedModels,
};