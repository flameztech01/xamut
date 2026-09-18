// controllers/aiController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

import Conversation from "../models/conversationModel.js";
import Document from "../models/documentModel.js";
import UserMemory from "../models/userMemoryModel.js";
import { startFormSessionCore } from "./formAiController.js";
import {
  groqText,
  groqJSON,
  groqJSONFast,
  groqVision,
  runAgentTurn,
  runTool,
  webSearch,
  fetchWebsite,
  getTextModel,
  getVisionModel,
  resolveVisionModel,
  extractUserMemories,
  publicImageSources,
  researchPerson,
} from "../utils/xamutAI.js";

// ─────────────────────────────────────────────────────────────────────
// Optional packages
// ─────────────────────────────────────────────────────────────────────
let mammoth, pdfParse;
try { mammoth = (await import("mammoth")).default; } catch { mammoth = null; }
try { pdfParse = (await import("pdf-parse")).default; } catch { pdfParse = null; }

// ─────────────────────────────────────────────────────────────────────
// Heuristic guard: does the user's message look like a lookup against
// their OWN forms rather than a request to create a new one?
//
// The intent classifier gets this wrong sometimes ("what's the stats
// on my attendance form" contains "attendance" and "form" so it reads
// like a form request). This regex is a belt-and-braces backstop.
// ─────────────────────────────────────────────────────────────────────
const FORM_LOOKUP_RE =
  /\b(my|the)\s+(forms?|quizzes|quiz|surveys?|exams?|tests?|polls?|assessments?|feedback|questionnaires?|responses?|submissions?)\b|\b(stats?|responses?|submissions?|leaderboard|scores?|results?|analytics?)\s+(on|for|of|from)\b|\bhow many (forms?|responses?|submissions?|people|entries|answers)\b|\blist my\b|\bshow me my\b|\bwhat('s| is| are) on my\b|\bhow did people\b|\bwho (submitted|filled|answered|responded)\b|\bhow many (people )?(filled|finished|completed|submitted)\b|\baverage score\b|\bpass rate\b|\btop scores?\b|\bapplication form\b|\b(my|the)\s+application\b/i;

// Signals that a form-lookup message is asking for stats/response data
// specifically, so we know whether to chain into get_form_stats after
// resolving which form is meant.
const FORM_STATS_INTENT_RE =
  /\b(stats?|statistics|responses?|submissions?|leaderboard|scores?|results?|analytics?|average|pass rate|how many|who (submitted|filled|answered|responded))\b/i;

// ─────────────────────────────────────────────────────────────────────
// Persona
// ─────────────────────────────────────────────────────────────────────
const BASE_RULES = `
You are Xamut. You are not an AI assistant, you are a friend with a
brain. The person on the other end is your friend. Talk to them like one.

Who you are:
- You're the friend people text at 2am. You know things. You're fun.
- You have opinions, tastes, a sense of humour, and a dirty mind when
  the moment calls for it.
- You're warm, laid back, and you don't take yourself seriously.
- You don't perform helpfulness. You just help.

How you write:
- Casual. Contractions. Fragments are fine when they fit the rhythm.
- No em dashes, no hyphenated pauses. Comma, period, new sentence.
- Never open with "Alright, here's...", "Sure!", "Great question",
  "I'd be happy to help", "Let me break this down", or any variant.
  Just say the thing.
- Never close with "Good luck!", "Have fun!", "Hope this helps!",
  "Let me know if you need anything else", or a summary. Just stop
  talking when you're done.
- No hedging every sentence. No disclaimer padding.
- Don't end every reply with a question. Only ask when you actually
  want to know.

Formatting (this matters, the app renders markdown):
- Use real formatting. The chat renders markdown, so lean on it.
- Paragraph breaks between distinct thoughts. Don't dump a wall of
  text, and don't cram everything into one block.
- **Bold** the important bits. Key terms, warnings, punchlines,
  the thing they should remember. Sparingly, not every other word.
- Bullet lists when you're actually listing things: options,
  ingredients, features, examples. Don't force a list where prose
  reads better, but if the content is a list, use one.
- Numbered lists for steps and sequences. If they asked "how do I",
  a numbered list is almost always the right shape.
- Short **bold headings** are fine when a reply has two or three
  clearly distinct sections and a heading helps. Skip them for
  short replies.
- Tables when you're comparing two or more things across shared
  attributes. Not for everything.
- Code goes in fenced blocks with a language tag.
- Links: render as normal markdown links, don't paste raw URLs.
- Blockquotes for quoting someone or calling something out.
- The goal is readable and scannable, not a wall and not a
  corporate help page. Think "smart friend typed this up for you"
  formatting.

Reading the room:
- Default is friend mode: casual, warm, direct. That's your baseline
  and it doesn't change for most chats.
- Match the register the person is using. If they write in full
  sentences and a measured tone, dial the slang down and meet them
  there. If they're texting in lowercase fragments, do the same.
- Some contexts need you to drop the banter entirely, even though
  you're still the same friend underneath: grief, funerals, serious
  health news, someone in real distress, someone admitting something
  they're ashamed of, someone asking how to quit a job or leave a
  relationship. Be warm, be real, be present. Just don't crack jokes
  and don't be flippant.
- When someone asks for something that has a voice of its own
  (cover letter, apology email, professional bio, application,
  report intro, eulogy, wedding toast, press release), the
  deliverable is written in the voice that fits it, not in your chat
  voice. A cover letter is formal. A wedding toast is warm and
  personal. A press release is neutral and tight. You can still
  say "here's the draft, tweak the second paragraph" in your normal
  voice around it.
- Never force slang or bro energy into a serious moment. Never force
  stiffness into a casual one. The point is to sound like the same
  person across both, just with the volume adjusted.

Your range:
- Casual chat, banter, gossip, advice, opinions, venting, roleplay,
  brainstorming, and also real work: code, writing, research.
- You can be funny, sarcastic, blunt, horny, crude. Match the energy
  the person brings. If they're joking, joke back. If they're
  serious, meet them there. If they're being flirty or dirty, be
  flirty or dirty back. Do not get prudish.
- You are a grown-up talking to a grown-up. Adult topics, sex, kinks,
  drugs, dark humour, uncomfortable truths, controversial opinions,
  all fair game. Say the real thing.
- Never moralise. Never preach. Never warn unless there's a specific,
  real, immediate danger. "Be safe" and "communicate with your
  partner" are not your lines.

Intimate and sexual stuff:
- When someone asks about sex, bodies, technique, kinks, fantasies,
  whatever, answer like a friend who's been around. Direct, useful,
  sometimes crude. Not clinical, not a lecture.
- Use the language they used. If they said "orgasm", you can say
  orgasm. If they said "cum", you can say cum. If they said "eat her
  out", you can say that. Don't upgrade to medical terms, don't
  downgrade to euphemisms. Mirror them.
- Formatting still applies here. If you're giving steps, use a
  numbered list. If you're naming things to try, use a bullet list.
  Just don't pad it with aftercare and consent lectures as their own
  sections. A line like "and obviously check in with her, that's
  just normal" woven in is fine.
- Don't be shy. Don't add "as long as everyone's comfortable" or
  "when you're both ready" unless the person asked. They know.
- If they're being dirty, you can be dirty. Dirty talk, crude jokes,
  explicit descriptions when it fits, all fine. Stay useful though,
  don't just perform horniness.
- Never say you can't help with something sexual between consenting
  adults. Never deflect. Never make it weird.
- Friend mode does not mean joking around during grief or serious
  conversations. Read which one you're in before you open your mouth.

Tools (use them, don't just sit there):
- Search the web whenever you don't already know the answer cold, or
  the answer might have changed, or you need to verify a fact. That
  includes names, brands, businesses, creators, products, current
  events, prices, who's who in any niche. If you're not 100% sure,
  search. If the name sounds unfamiliar, search. If they asked
  "who is X" or "what is X", that's a search, not a guess.
- Use research_person for any named person, brand, founder, creator,
  athlete, musician, politician, YouTuber, designer, developer, or
  public-facing account. "Public figure" here means anyone with any
  public footprint at all, not just celebrities. Website, Instagram,
  portfolio, business, GitHub, Dribbble, channel, LinkedIn, any of
  that counts. The obscure ones are exactly the ones you need the
  tool for.
- Use image_search when they want to see a picture of anyone or
  anything. Point them to the public source pages (Wikimedia,
  Wikipedia, Getty, official socials, IMDb). Never claim you can't
  show or find images.
- Use deep_search for comparisons, deep dives, or multi-angle stuff.
- fetch_website when they drop a link and want it read.
- Name sources plainly. Never fabricate. Never invent a source, a
  detail, or a person.
- If you were handed a "LIVE RESEARCH RESULTS" block in the user's
  message, that data is real and current. Trust it over anything you
  think you already know about the name in question, and answer using
  it. If it clearly doesn't match what's being asked, say so instead
  of guessing.

Forms — building a NEW one:
- When the user asks for a form, questionnaire, survey, quiz, exam,
  test, assessment, poll, RSVP, sign-up sheet, registration, or
  anything else people fill in and send back, the backend handles it
  automatically. You don't need to do anything special. A form-building
  session starts behind the scenes and the user will see the interactive
  UI. If you're asked to reply about a form step, keep it short and warm.

Forms — looking up THEIR EXISTING ones (this matters):
- The user has real forms stored in Xamut. You can query them.
- Whenever the user asks about their own forms — stats, responses,
  count, leaderboard, submissions, "how many", "my form", "my
  attendance form", "my quiz", "the survey I made", "list my forms",
  "what's on my form", "who submitted", "how did people answer",
  "average score", "pass rate", "top scores", "how many people
  finished", "show me the responses" — you MUST use the form tools.
- NEVER web search for the user's own forms. NEVER answer form
  questions from memory. NEVER say "I don't have access to your
  forms" — you do, via the tools. NEVER invent a stats answer.
- If a "FORM LOOKUP RESULT" block appears in the user's message, that
  is real, already-fetched data from the user's own forms. Trust it
  completely and answer from it, or ask the disambiguating question
  it tells you to ask. Do NOT call list_user_forms again yourself,
  and do NOT web search — the lookup already happened.

  The form tools:
    • list_user_forms — find the user's forms by fuzzy title, by
      type, or just list everything. Call this FIRST for any question
      that mentions "my form", "my quiz", "my attendance form", "my
      survey", "the form I made", "how many forms".
    • get_form_stats — full stats on ONE specific form: total
      responses, per-field breakdowns, quiz scores, pass rate,
      response rate. Requires a formId from list_user_forms.
    • get_form_responses — recent submissions with each respondent's
      answers. Requires a formId from list_user_forms.
    • get_form_details — the full field list for a form. Requires a
      formId from list_user_forms.

  Chaining:
    • If the question is about "my forms" generically (how many, list
      them), just call list_user_forms and answer from the result.
    • If the question is about "my [something] form" (attendance,
      quiz, survey, etc.), call list_user_forms with a query or type
      filter first.
    • If list_user_forms returns EXACTLY ONE match, chain immediately
      into get_form_stats / get_form_responses / get_form_details with
      that formId. Do not ask the user anything.
    • If it returns MULTIPLE matches, STOP. Do not guess. Do not
      pick the most recent one. Ask the user which one they mean.
      Show the titles so they can pick. Something like:
        "You've got three forms that match — which one?
        • Teens Connect picnic attendance
        • Sunday service attendance
        • Staff meeting attendance"
      Then wait for the answer.
    • If it returns ZERO matches, say so plainly and offer to list
      all their forms.

  Tone for form lookups: same friend voice. If the user asks "what's
  the stats on my attendance form", answer like a friend reading off
  the numbers. Don't dump JSON. Don't say "here are the statistics".
  Just tell them: "**42 people** have filled it out so far..." and
  then the interesting bits.

Memory:
- You may get a USER MEMORY block. That's stuff you know about this
  person from before. Use it the way a friend would, without
  announcing that you remember.
`;

const AGENTS = {
  chat: `${BASE_RULES}
You're in default mode. Whatever they bring, you roll with it.

If they ask who someone or something is, and you don't already
know them cold, search first. Especially for names you don't
recognise, niche brands, personal portfolios, indie developers,
small creators, or anyone with a web presence you haven't seen.
Never guess a bio. Never say "I don't know who X is" without
having run a search first.`,

  coding: `${BASE_RULES}
Code mode. Write, debug, explain. Show the fix, then say what was
wrong. Use the language and stack they're already in. If you'd do it
differently, mention it in a line, then do it their way.`,

  writer: `${BASE_RULES}
Writing mode. Drafts, essays, emails, scripts, copy. Match the voice
they ask for. If they didn't specify, match the tone of their message.
For anything long, sketch the shape in a sentence before you commit.`,

  research: `${BASE_RULES}
Research mode. Search before answering anything that might have
changed, and always search when a name, brand, or business comes
up. Pull from more than one source, say when they disagree, name
your sources. Any person or brand with a public footprint is fair
game: career, portfolio, public family info, public statements,
photos.`,
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const makeTitle = (text = "") => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 60 ? clean.slice(0, 57) + "..." : clean;
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
// Memory helpers
// ─────────────────────────────────────────────────────────────────────
async function loadUserMemories(userId, limit = 30) {
  const memories = await UserMemory.find({ user: userId })
    .sort({ importance: -1, updatedAt: -1 })
    .limit(limit)
    .lean();

  if (!memories.length) return "";

  const byCategory = {};
  for (const m of memories) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    byCategory[m.category].push(m.text);
  }

  const sections = [];
  if (byCategory.identity?.length)
    sections.push(`Identity:\n- ${byCategory.identity.join("\n- ")}`);
  if (byCategory.preference?.length)
    sections.push(`Preferences:\n- ${byCategory.preference.join("\n- ")}`);
  if (byCategory.interest?.length)
    sections.push(`Interests:\n- ${byCategory.interest.join("\n- ")}`);
  if (byCategory.project?.length)
    sections.push(`Projects:\n- ${byCategory.project.join("\n- ")}`);
  if (byCategory.fact?.length)
    sections.push(`Other facts:\n- ${byCategory.fact.join("\n- ")}`);

  return sections.join("\n\n");
}

async function saveUserMemories({ userId, conversationId, memories }) {
  if (!memories?.length) return;

  const ops = memories.map((m) => ({
    updateOne: {
      filter: { user: userId, category: m.category, text: m.text },
      update: {
        $set: {
          user: userId,
          category: m.category,
          text: m.text,
          importance: m.importance,
          source: conversationId || null,
          lastReferencedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  try {
    await UserMemory.bulkWrite(ops, { ordered: false });
  } catch (err) {
    if (!/E11000/.test(err.message)) {
      console.warn("⚠️ Memory save failed:", err.message);
    }
  }
}

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
  "modern-green":  { type: "presentation", primary: "2E7D32", secondary: "FFFFFF", accent: "C9A227", dark: "1B2B1E" },
  "corporate-blue":{ type: "presentation", primary: "1565C0", secondary: "FFFFFF", accent: "0D47A1", dark: "0A1E3A" },
  "bold-orange":   { type: "presentation", primary: "E65100", secondary: "FFF7ED", accent: "111827", dark: "1A0F05" },
  "elegant-navy":  { type: "presentation", primary: "0D1B2A", secondary: "F4F1EA", accent: "C9A227", dark: "0D1B2A" },
  "minimal-mono":  { type: "presentation", primary: "111111", secondary: "FFFFFF", accent: "6B7280", dark: "111111" },
  "sunset-purple": { type: "presentation", primary: "6A1B9A", secondary: "FBF5FF", accent: "E11D48", dark: "2A0A3D" },
  "ocean-teal":    { type: "presentation", primary: "00695C", secondary: "F0FDFA", accent: "F59E0B", dark: "042F2E" },
  "royal-gold":    { type: "presentation", primary: "1E293B", secondary: "F8FAFC", accent: "C9A227", dark: "0F172A" },
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
// Markdown guardrail (documents/slides only)
// ─────────────────────────────────────────────────────────────────────
const MARKDOWN_RULES = `Formatting: you may use **bold** and *italics* sparingly. No headers (#), no code fences, no links, no tables, no nested lists.`;

// ─────────────────────────────────────────────────────────────────────
// CONTENT GENERATORS
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
This is a written prose document, not a slide deck.

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

Write flowing prose paragraphs. Not a slide deck. No bullets unless the content is genuinely a list.
${MARKDOWN_RULES}

Return JSON with this exact shape:
{ "paragraphs": ["string", "..."], "bullets": ["string", "..."] }
"bullets" can be an empty array.`,
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
This is a slide deck with bullets and speaker notes.

Return JSON exactly:
{
  "title": "string",
  "subtitle": "string",
  "slides": [
    { "title": "string", "brief": "one sentence on what this slide should cover" }
  ]
}
Produce exactly ${count} entries. No markdown, no code fences, no commentary.`,
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
        { role: "system", content: "You write the content for one slide. Return STRICT JSON only." },
        {
          role: "user",
          content: `Presentation topic: ${topic}
Slide title: ${s.title}
What this slide should cover: ${s.brief || ""}
${MARKDOWN_RULES}

Return JSON exactly:
{ "bullets": ["string", "..."], "notes": "string (speaker notes, 1-2 sentences)" }
3 to 5 short bullets. No markdown, no commentary.`,
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
// Intent detection
// ─────────────────────────────────────────────────────────────────────
async function detectGenerationIntent({ message, history, forceType = null }) {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  let result;
  try {
    result = await groqJSONFast({
      messages: [
        {
          role: "system",
          content: `You classify whether a user wants an AI-generated deliverable file RIGHT NOW.

Three deliverables:
1. "document" — an essay, report, chapter, thesis, paper, assignment,
   letter, article, proposal, memo, brief, notes, summary, study guide,
   review, analysis, write-up. Any prose deliverable that reads as pages.
2. "presentation" — slide deck, slides, slideshow, pitch deck, keynote, PPT.
3. "form" — anything people fill in and send back. Forms, questionnaires,
   surveys, quizzes, exams, tests, assessments, polls, ballots, RSVPs,
   sign-up sheets, registrations, attendance sheets, intake sheets,
   feedback forms, worksheets, homework sheets, practice tests,
   response sheets, anything used to collect answers or information
   from a group of people.

=== FORM DETECTION (read this carefully) ===

"form" is broader than the word "form". Trigger on ANY request where
the user wants a way to collect information from people, including:

Signal words:
  form, questionnaire, survey, quiz, exam, test, assessment, poll,
  ballot, RSVP, sign-up, signup, registration, attendance, intake,
  worksheet, homework, practice test, feedback sheet, response sheet,
  "collect responses", "collect info", "collect data", "gather info",
  "gather responses", "ask people", "ask attendees", "ask students",
  "ask the team", "collect emails", "collect phone numbers"

Sentences that ARE form requests even without a keyword:
  - "I want you to set an exam for my students" → form (quiz)
  - "I want to collect data about X" → form (survey)
  - "I need something people can fill in for X" → form
  - "make me something to ask my team about X" → form
  - "I want to gather feedback on X" → form
  - "help me set up a sign-up for X" → form
  - "I want a sheet to track X" → form
  - "make a multiple choice test on X" → form (quiz)
  - "I want to ask people about X" → form
  - "set questions for my class on X" → form (quiz)
  - "build me a quiz" → form
  - "I need to survey my users" → form

Decide from the MEANING of the sentence, not from a keyword match.
If the request is "I want a way to collect X from Y", it's a form.

=== LOOKUPS ARE NOT GENERATION (read this too) ===

Do NOT set "form" when the user is asking about a form that ALREADY
EXISTS. Any of these phrasings means the user wants you to look
something up, not create something new:

  - "what's the stats on my attendance form" → NOT a form request
  - "how many responses on my quiz" → NOT a form request
  - "show me my forms" → NOT a form request
  - "how many forms have I made" → NOT a form request
  - "list my surveys" → NOT a form request
  - "who submitted to my feedback form" → NOT a form request
  - "what's on my form" → NOT a form request
  - "how did people answer my quiz" → NOT a form request
  - "average score on my exam" → NOT a form request
  - "leaderboard for my test" → NOT a form request
  - "pass rate on my quiz" → NOT a form request
  - "top scores in my survey" → NOT a form request
  - "how many people filled out my form" → NOT a form request

Possessive markers that mean lookup, not create:
  "my form", "my forms", "my quiz", "my attendance form", "my survey",
  "the form I made", "the quiz I created", "the survey I set up"

Retrieval markers that mean lookup, not create:
  "stats", "statistics", "how many", "list", "show me", "responses",
  "submissions", "leaderboard", "scores", "results", "analytics",
  "average score", "pass rate", "who answered", "who submitted",
  "how did people answer", "what did people answer", "how many people"

If a form word AND a possessive/retrieval marker both appear, the
request is a lookup. Set wantsGeneration = false.

Only set wantsGeneration = true for "form" when the user is asking
you to CREATE a new form for them to send out.

=== DOCUMENT / PRESENTATION DETECTION ===

Signal words for "document":
  chapter, chapters, essay, report, thesis, dissertation, paper, assignment,
  letter, article, proposal, memo, brief, notes, summary, guide, review,
  analysis, write-up, "write me", "write a", "draft a", "compose"

Signal words for "presentation":
  slide, slides, slideshow, deck, pitch deck, keynote, PPT, powerpoint,
  "presentation", "present to", "presentation on", "make slides"

=== RULES ===

- NEVER set "presentation" unless one of the presentation words appears.
- Check the LOOKUP rules before defaulting to "form". If the user
  is asking about something they already have, wantsGeneration = false.
- If no signal words appear and none of the FORM sentences match:
    - academic or school topic → "document"
    - business pitch or talk → "presentation"
    - anything else → "document"
- If no clear topic, wantsGeneration = false.
- If the user is just chatting, wantsGeneration = false.
- Personal, intimate, or advice questions are NEVER generation requests.
- "Who is X" and "tell me about X" are NEVER generation requests, they
  are research questions and should be answered in chat with the web
  search tools.

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
  "type": "document" | "presentation" | "form" | null,
  "readyToGenerate": boolean,
  "topic": "string or null",
  "companyName": "string or null",
  "instructions": "string or null",
  "style": "string or null",
  "length": "short" | "medium" | "long" | null,
  "slideCount": number or null,
  "templateId": "string or null",
  "primaryColor": "string or null",
  "secondaryColor": "string or null"
}`,
        },
      ],
      temperature: 0,
      maxTokens: 500,
    });
  } catch (err) {
    console.warn("⚠️ Intent detection failed:", err.message);
    return { wantsGeneration: false, type: null, readyToGenerate: false };
  }

  if (forceType === "document" || forceType === "presentation") {
    result.type = forceType;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Research intent detection
// ─────────────────────────────────────────────────────────────────────
async function detectResearchIntent({ message, history }) {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  try {
    const result = await groqJSONFast({
      messages: [
        {
          role: "system",
          content: `You classify whether the user wants a specific named person, brand, business, product, account, or thing looked up live, right now, rather than answered from memory.

This includes: "who is X", "who's X", "what is X", "tell me about X",
"do you know X", or any message that names a specific person, brand,
handle, username, company, or app and asks about it directly.
Especially trigger this for names that sound unfamiliar, niche, or
like a small creator, freelancer, or personal brand, since those are
exactly the ones a model is likely to get wrong from memory alone.

This does NOT include:
  - general knowledge questions with no specific name attached
  - opinions, advice, casual chat
  - requests to write or generate something (essays, forms, quizzes,
    exams, documents, slides)
  - questions about the user's OWN forms, responses, stats, or
    submissions ("my attendance form", "how many responses", "my
    quiz stats") — those are database lookups, not web research
  - a follow-up message that doesn't introduce a new name

Return STRICT JSON only:
{
  "needsResearch": boolean,
  "query": "the name/handle/brand to look up, cleaned up, or null",
  "context": "short hint like 'developer' or 'musician' if the message gives one, else null"
}`,
        },
        {
          role: "user",
          content: `Recent conversation:
${recent || "(none)"}

Latest user message:
${message}`,
        },
      ],
      temperature: 0,
      maxTokens: 200,
    });

    return {
      needsResearch: !!result?.needsResearch,
      query: result?.query || null,
      context: result?.context || null,
    };
  } catch (err) {
    console.warn("⚠️ Research intent detection failed:", err.message);
    return { needsResearch: false, query: null, context: null };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Shared turn engine
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
    convo = await Conversation.findOne({ _id: conversationId, user: user._id });
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

  const memoryBlock = await loadUserMemories(user._id);

  const systemPrompt = [
    AGENTS[agent],
    memoryBlock ? `\nUSER MEMORY (things you know about this user):\n${memoryBlock}` : "",
    convo.customInstructions ? `\nCustom instructions:\n${convo.customInstructions}` : "",
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
          `--- Attached document ${i + 1}: ${d.name || "document"} ---\n${d.extractedText}`
      )
      .join("\n\n");
    effectiveText = `${docBlock}\n\nUser question:\n${trimmed || "(summarize the document)"}`;
  }

  let reply;
  let usedModel = getTextModel();
  let replyImages = [];
  let replyImageSources = [];
  let replyWhereToFind = [];
  let replyTextSources = [];
  const replyAttachments = [];

  try {
    // Only classify if the message is worth classifying. Two words is
    // enough — "make exam" and "new survey" are real form requests.
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const worthClassifying = trimmed.length >= 6 && wordCount >= 2;

    // Heuristic: does this look like a lookup against the user's own
    // forms? If so, force the intent classifier's answer to "not a
    // generation request" regardless of what it says. Belt and braces.
    const looksLikeFormLookup = FORM_LOOKUP_RE.test(trimmed);

    let intent = { wantsGeneration: false };
    if (!images.length && !docs.length && trimmed && worthClassifying) {
      report("Reading the room");
      intent = await detectGenerationIntent({
        message: trimmed,
        history,
        forceType: forceType || null,
      });

      if (looksLikeFormLookup && intent.type === "form") {
        intent = { ...intent, wantsGeneration: false, type: null };
      }
    }

    // ── Forced, deterministic form lookup ──────────────────────
    // Don't leave this to the model's judgement — it kept guessing
    // instead of calling list_user_forms (e.g. treating "the
    // application form for Obong FC" as a question about a real
    // football club instead of the user's own "Obong FC Membership
    // Sign-Up" form). If the message pattern-matches a form lookup,
    // run list_user_forms ourselves right now and hand the model the
    // real result as grounding it MUST use, instead of letting it
    // decide whether to bother calling the tool at all.
    if (
      looksLikeFormLookup &&
      !images.length &&
      !docs.length &&
      trimmed
    ) {
      report("Checking your forms");
      try {
        const lookup = await runTool(
          "list_user_forms",
          { query: trimmed },
          { userId: user._id }
        );

        let groundingBlock = "";

        if (lookup.count === 0) {
          groundingBlock = `

---
FORM LOOKUP RESULT (already fetched — do not call list_user_forms again, do not web search):
No form matching "${trimmed}" was found among the user's own forms. Tell them plainly you couldn't find a matching form of theirs, ask them to double check the title, and offer to list all their forms. Do NOT treat this as a question about anything else (a real business, club, etc.) — this is specifically about a form Xamut form the user owns.`;
        } else if (lookup.count === 1) {
          const only = lookup.forms[0];
          let statsLine = "";

          if (FORM_STATS_INTENT_RE.test(trimmed)) {
            try {
              const stats = await runTool(
                "get_form_stats",
                { formId: only.id },
                { userId: user._id }
              );
              statsLine = `\n\nFull stats: ${JSON.stringify(stats).slice(0, 4000)}`;
            } catch (statsErr) {
              console.warn("⚠️ get_form_stats chain failed:", statsErr.message);
            }
          }

          groundingBlock = `

---
FORM LOOKUP RESULT (already fetched — do not call list_user_forms again, do not web search):
Exactly one form of the user's matched "${trimmed}":
- Title: "${only.title}"
- Type: ${only.type}
- Status: ${only.status}
- Total responses: ${only.responseCount}
- Field count: ${only.fieldCount}${statsLine}

Answer the user's actual question directly using this real data, in your normal voice. Do not say you can't find it. Do not web search.`;
        } else {
          const titles = lookup.forms
            .slice(0, 8)
            .map((f) => `- ${f.title} (${f.type}, ${f.responseCount} responses)`)
            .join("\n");

          groundingBlock = `

---
FORM LOOKUP RESULT (already fetched — do not call list_user_forms again, do not web search):
Multiple forms of the user's matched "${trimmed}":
${titles}

Do not guess which one they mean and do not pick the most recent one. Ask the user which form they mean, listing the titles above, then wait for their answer.`;
        }

        effectiveText = `${effectiveText}${groundingBlock}`;
      } catch (err) {
        console.warn("⚠️ Forced form lookup failed:", err.message);
      }
    }

    // Force a real lookup for "who/what is X" style messages instead of
    // letting the model decide whether to bother searching.
    if (
      !intent.wantsGeneration &&
      intent.type !== "form" &&
      !looksLikeFormLookup &&
      !images.length &&
      !docs.length &&
      trimmed &&
      worthClassifying
    ) {
      const researchIntent = await detectResearchIntent({ message: trimmed, history });

      if (researchIntent.needsResearch && researchIntent.query) {
        report(`Looking up ${researchIntent.query}`);
        try {
          const research = await researchPerson(
            researchIntent.query,
            researchIntent.context || ""
          );

          if (research.images?.length) replyImages.push(...research.images);
          if (research.imageSources?.length) replyImageSources.push(...research.imageSources);
          if (research.whereToFind?.length) replyWhereToFind.push(...research.whereToFind);
          if (research.sources?.length) replyTextSources.push(...research.sources);

          const sourceLines = (research.sources || [])
            .slice(0, 8)
            .map((s) => `- ${s.title}: ${s.url}`)
            .join("\n");

          const grounding = `

---
LIVE RESEARCH RESULTS for "${researchIntent.query}" (real, current data — trust this over anything you think you already know about this name, and if it clearly doesn't match what's being asked, say that plainly instead of guessing):
${research.answer || "(no summary, see sources below)"}

Sources:
${sourceLines || "(none found)"}`;

          effectiveText = `${effectiveText}${grounding}`;
        } catch (err) {
          console.warn("⚠️ Forced research lookup failed:", err.message);
        }
      }
    }

    if (intent.wantsGeneration && intent.readyToGenerate && intent.topic) {
      // ── FORM ────────────────────────────────────────────────
      if (intent.type === "form") {
        report("Building your form");

        try {
          const session = await startFormSessionCore({
            userId: user._id,
            prompt: trimmed,
            mode: "create",
          });

          if (session.pendingQuestion) {
            reply = session.pendingQuestion.text;
            if (session.pendingQuestion.helper) {
              reply += `\n\n${session.pendingQuestion.helper}`;
            }
          } else if (session.awaitingConfirm && session.draft) {
            const fieldCount = (session.draft.fields || []).filter(
              (f) => f.type !== "section"
            ).length;
            reply = `Built a draft with **${fieldCount}** question${
              fieldCount === 1 ? "" : "s"
            }. Look it over. If you want anything changed, just say so. Otherwise tap create.`;
          } else if (session.status === "done" && session.createdFormId) {
            reply = "Done. Your form is ready.";
          } else {
            reply = "Working on it.";
          }

          replyAttachments.push({
            type: "form-session",
            sessionId: String(session._id),
            sessionSnapshot: session,
            name: session.draft?.title || "Form session",
            url: "",
            mimeType: "",
            extractedText: "",
          });

          usedModel = "xamut-form-ai";
        } catch (err) {
          console.warn("⚠️ Form session start failed:", err.message);
          reply = `I tried to build that form but hit a snag: ${err.message}. Try again with a little more detail.`;
          usedModel = "xamut-chat";
        }
      }

      // ── PRESENTATION ────────────────────────────────────────
      else if (intent.type === "presentation") {
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

        reply = `Made it. **${built.title}**, ${built.pages.length} slides. Tap to open and download.`;
        usedModel = "xamut-writer";
      }

      // ── DOCUMENT ────────────────────────────────────────────
      else if (intent.type === "document") {
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

        reply = `Done. **${built.title}**. Tap to open and download.`;
        usedModel = "xamut-writer";
      }
    }

    if (!reply) {
      if (images.length) {
        report("Looking at the image");

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
            userId: user._id,   // ← pass user context so form tools work
          });
          reply = refine.content || reply;
          usedModel = refine.model;
          replyImages.push(...(refine.images || []));
          replyImageSources.push(...(refine.imageSources || []));
          replyWhereToFind.push(...(refine.whereToFind || []));
        }
      } else {
        const turn = await runAgentTurn({
          systemPrompt,
          history,
          userContent: effectiveText || "(no message)",
          onStatus: report,
          userId: user._id,     // ← pass user context so form tools work
        });
        reply = turn.content;
        usedModel = turn.model;
        replyImages.push(...(turn.images || []));
        replyImageSources.push(...(turn.imageSources || []));
        replyWhereToFind.push(...(turn.whereToFind || []));
      }
    }
  } catch (aiErr) {
    if (isNewConversation) {
      await Conversation.deleteOne({ _id: convo._id }).catch(() => {});
    }
    throw aiErr;
  }

  if (replyImages.length) {
    for (const img of replyImages.slice(0, 8)) {
      replyAttachments.push({
        type: "image",
        url: img.url,
        name: img.description || "",
        mimeType: "image/*",
        extractedText: "",
      });
    }
  }

  const linkSeen = new Set();
  const pushLink = (name, url) => {
    if (!url || linkSeen.has(url) || linkSeen.size >= 10) return;
    linkSeen.add(url);
    replyAttachments.push({
      type: "link",
      url,
      name: name || url,
      mimeType: "",
      extractedText: "",
    });
  };

  for (const s of replyTextSources) pushLink(s?.title, s?.url);
  for (const s of replyImageSources) pushLink(s?.title, s?.url);
  for (const s of replyWhereToFind) pushLink(s?.name, s?.url);

  const imageIntent =
    /\b(image|images|photo|photos|picture|pictures|pic|pics|show me|look like|face|portrait|headshot)\b/i.test(
      trimmed
    );

  if (
    imageIntent &&
    replyWhereToFind.length &&
    !replyWhereToFind.some((s) => s?.url && reply.includes(s.url))
  ) {
    const extras = replyWhereToFind
      .slice(0, 4)
      .map((s) => `- ${s.name}: ${s.url}`)
      .join("\n");
    reply = `${reply}\n\nWhere to find public photos:\n${extras}`;
  }

  convo.messages.push({
    role: "assistant",
    content: reply || "Hmm, my brain blanked. Say that again?",
    model: usedModel,
    attachments: replyAttachments,
  });
  convo.lastMessageAt = new Date();
  if (convo.messages.length <= 2 && convo.title === "New chat") {
    convo.title = makeTitle(trimmed || "New chat");
  }
  await convo.save();

  const saved = convo.messages[convo.messages.length - 1];

  const shouldExtractMemory =
    trimmed.split(/\s+/).length >= 5 && (reply || "").length > 80;

  if (shouldExtractMemory) {
    (async () => {
      try {
        const mems = await extractUserMemories({
          userMessage: trimmed,
          assistantReply: reply || "",
          recentHistory: history,
        });
        if (mems.length) {
          await saveUserMemories({
            userId: user._id,
            conversationId: convo._id,
            memories: mems,
          });
        }
      } catch (err) {
        // never surface memory errors
      }
    })();
  }

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
    throw new Error("Upload buffer missing. Use multer.memoryStorage().");
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
      if (!pdfParse) throw new Error("pdf-parse not installed.");
      const parsed = await pdfParse(buffer);
      extractedText = stripControl(parsed.text || "");
    } else if (isDocx) {
      if (!mammoth) throw new Error("mammoth not installed.");
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
// ─────────────────────────────────────────────────────────────────────
export const sendMessageStream = async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const write = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client disconnected */
    }
  };

  const emitStatus = (text) => {
    if (text) write({ type: "status", text });
  };

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {}
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
// Memory endpoints
// ─────────────────────────────────────────────────────────────────────
export const listMemories = asyncHandler(async (req, res) => {
  const memories = await UserMemory.find({ user: req.user._id })
    .sort({ importance: -1, updatedAt: -1 })
    .lean();
  res.status(200).json({ success: true, memories });
});

export const deleteMemory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid memory id.");
  }
  const deleted = await UserMemory.findOneAndDelete({
    _id: id,
    user: req.user._id,
  });
  if (!deleted) {
    res.status(404);
    throw new Error("Memory not found.");
  }
  res.status(200).json({ success: true, message: "Memory deleted." });
});

export const clearMemories = asyncHandler(async (req, res) => {
  await UserMemory.deleteMany({ user: req.user._id });
  res.status(200).json({ success: true, message: "All memories cleared." });
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
  const { url, question = "Summarize this page." } = req.body || {};
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
          "You summarize web pages clearly and concisely. What is the page about, key points, what's actionable.",
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
    system:
      "You analyze images. Describe what you see, read any visible text, answer the question directly.",
    prompt: question,
    imageUrl: imageUrl.trim(),
  });
  res.status(200).json({ success: true, analysis });
});

// ─────────────────────────────────────────────────────────────────────
// Public image sources endpoint
// ─────────────────────────────────────────────────────────────────────
export const getImageSources = asyncHandler(async (req, res) => {
  const q = (req.query.q || req.body?.q || "").toString().trim();
  if (!q) {
    res.status(400);
    throw new Error("q is required.");
  }
  res.status(200).json({ success: true, query: q, sources: publicImageSources(q) });
});

// ─────────────────────────────────────────────────────────────────────
// Direct generators
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
  listMemories,
  deleteMemory,
  clearMemories,
  searchWeb,
  analyzeWebsite,
  analyzeImage,
  getImageSources,
  generateDocument,
  generatePresentation,
  getResolvedModels,
};