// controllers/aiController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

import Conversation from "../models/conversationModel.js";
import Document from "../models/documentModel.js";
import UserMemory from "../models/userMemoryModel.js";
import { startFormSessionCore } from "./formAiController.js";
import { buildIntentFeatureList } from "../config/formCapabilities.js";
import {
  groqText,
  groqJSON,
  groqJSONFast,
  groqVision,
  runAgentTurn,
  runSmartTurn,
  runTool,
  webSearch,
  fetchWebsite,
  getTextModel,
  getVisionModel,
  resolveVisionModel,
  resolveTextModel,
  extractUserMemories,
  publicImageSources,
  researchPerson,
  estimateTokens,
} from "../utils/xamutAI.js";

const FORM_INTENT_FEATURE_LIST = buildIntentFeatureList();

// ═════════════════════════════════════════════════════════════════════
// DOCUMENT SHAPE — top-level knobs
// ═════════════════════════════════════════════════════════════════════

// When FALSE (the default), a cover / front-matter page is only added
// when the user literally asked for one ("with a cover page", "add a
// title page", ...). Formal documents like "3-page assignment on X"
// come out as plain documents with a title line, not a full cover.
//
// Flip to TRUE if you later want formal academic / business requests
// to get a cover page automatically even without the user asking.
const COVER_FOR_FORMAL_DOCS = false;

// Looks like a real academic or professional deliverable.
const FORMAL_DOC_RE =
  /\b(assignment|report|thesis|dissertation|term[\s-]?paper|research\s+paper|case\s+study|proposal|business\s+plan|essay|formal\s+report|project\s+work|capstone|white\s?paper|briefing|memorandum|memo)\b/i;

// User literally asked for a cover / title / front page.
const EXPLICIT_COVER_RE =
  /\b(cover\s+page|title\s+page|front\s+page|with\s+a\s+cover|add\s+a\s+cover|include\s+a\s+cover|with\s+a\s+title\s+page|add\s+a\s+title\s+page)\b/i;

// ─────────────────────────────────────────────────────────────────────
// Size discipline
// ─────────────────────────────────────────────────────────────────────
const HISTORY_MAX_MESSAGES = 10;
const HISTORY_MAX_CHARS_PER_MESSAGE = 1000;
const MEMORY_BLOCK_MAX_CHARS = 1500;
const CLASSIFIER_MESSAGE_CHAR_CAP = 3000;
const CLASSIFIER_HISTORY_TURNS = 4;
const CLASSIFIER_HISTORY_CHARS = 250;
const MAX_ATTACHMENTS = 3;
const MAX_DOC_TEXT_CHARS = 8000;
const MAX_DOC_BLOCK_CHARS = 18000;

const FORM_MEDIA_TYPES = new Set(["file", "image", "document"]);

// ─────────────────────────────────────────────────────────────────────
// A4 page math — the ground truth for "N pages" requests.
// ─────────────────────────────────────────────────────────────────────
const A4_WORDS_PER_PAGE = {
  10: { 1.0: 600, 1.15: 520, 1.5: 400, 2.0: 300 },
  11: { 1.0: 550, 1.15: 480, 1.5: 370, 2.0: 275 },
  12: { 1.0: 500, 1.15: 435, 1.5: 335, 2.0: 250 }, // default
  13: { 1.0: 450, 1.15: 390, 1.5: 300, 2.0: 225 },
  14: { 1.0: 400, 1.15: 350, 1.5: 270, 2.0: 200 },
  15: { 1.0: 355, 1.15: 310, 1.5: 240, 2.0: 180 },
  16: { 1.0: 320, 1.15: 280, 1.5: 215, 2.0: 160 },
  18: { 1.0: 260, 1.15: 225, 1.5: 175, 2.0: 130 },
};

function computeWordsPerPage({ fontSize = 12, lineSpacing = 1.5 } = {}) {
  const table = A4_WORDS_PER_PAGE[fontSize] || A4_WORDS_PER_PAGE[12];
  const keys = Object.keys(table).map(Number);
  const nearest = keys.reduce((a, b) =>
    Math.abs(b - lineSpacing) < Math.abs(a - lineSpacing) ? b : a
  );
  return table[nearest];
}

const DEFAULT_FONT_SETTINGS = {
  bodyFontSize: 12,
  headingFontSize: 16,
  fontFamily: "Calibri",
  lineSpacing: 1.5,
};

function buildFontSettings({ fontSize, lineSpacing, fontFamily } = {}) {
  return {
    ...DEFAULT_FONT_SETTINGS,
    ...(Number.isFinite(+fontSize) ? { bodyFontSize: Math.min(Math.max(+fontSize, 8), 32) } : {}),
    ...(Number.isFinite(+lineSpacing) ? { lineSpacing: Math.min(Math.max(+lineSpacing, 1), 3) } : {}),
    ...(typeof fontFamily === "string" ? { fontFamily } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Inline formatting rules injected into every writer prompt.
// ─────────────────────────────────────────────────────────────────────
const RICH_RULES = `Formatting (the renderer supports it, use it):
- **bold**, *italic*, __underline__ inside text and items.
- {color:#C62828}colored text{/color} for emphasis or warnings.
- {size:14}larger text{/size} to enlarge body copy (pt, 8-32). Body default is 12pt.
- Do NOT use markdown headers (#). Use a "heading" block instead.
- Do NOT use markdown bullet characters inside paragraphs. Use a "bullets" block.
- Do NOT use markdown numbered lists inside paragraphs. Use a "numbered" block.
- No tables, no code fences, no links, no images unless the user asked.`;

// ─────────────────────────────────────────────────────────────────────
// Per-section format directives.
// ─────────────────────────────────────────────────────────────────────
const SECTION_FORMATS = new Set([
  "prose", "mixed", "bullets", "steps", "qa", "list", "dialogue",
]);

function buildFormatDirective(fmt) {
  switch (fmt) {
    case "prose":
      return `Structure: fully flowing paragraphs. NO bullet lists, NO numbered lists, NO subheadings. Just prose.`;
    case "bullets":
      return `Structure: mostly bullet blocks. Lead with a one-sentence paragraph if it helps, then bullet the rest. Level-2 heading blocks are welcome to group bullets.`;
    case "steps":
      return `Structure: numbered list of steps. Optionally one intro paragraph, then a "numbered" block, then an optional closing paragraph. Use level-2 heading blocks if the steps fall into phases.`;
    case "qa":
      return `Structure: a sequence of Q&A pairs. Use a "heading" block (level 3) for each question, then a "paragraph" block for the answer. Keep answers focused.`;
    case "list":
      return `Structure: an enumerated list of items, each with a short bold lead-in. Use "bullets" or "numbered" blocks. Add a short intro and outro paragraph.`;
    case "dialogue":
      return `Structure: alternating paragraphs that read as back-and-forth dialogue. Prefix each line with the speaker's name in bold, e.g. "**Alex:** ...".`;
    case "mixed":
    default:
      return `Structure: a mix. Mostly paragraphs, but use "bullets" or "numbered" blocks where the content is genuinely a list, and level-2 "heading" blocks for real sub-topics. Don't force a list where prose reads better.`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Front matter block sanitizers.
//
// Front matter is a freestanding ORDERED block list. The order IS the
// layout. Whatever the AI emits, we keep it in order and just clamp
// sizes and enums so nothing breaks the renderer.
// ─────────────────────────────────────────────────────────────────────
const FM_TEXT_SIZES = new Set(["sm", "md", "lg", "xl", "2xl"]);
const FM_SPACER_SIZES = new Set(["sm", "md", "lg", "xl"]);
const FM_ALIGN = new Set(["left", "center", "right"]);

// Reject any block whose text still contains a placeholder marker.
// "[Your Name]", "[Date]", "[Course]" — the LLM loves these and they
// look terrible on a rendered cover.
const PLACEHOLDER_RE = /\[[^\]]{0,40}\]/;

function sanitizeFrontMatterBlocks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((b) => {
      if (!b || typeof b !== "object") return null;

      if (b.type === "spacer") {
        const size = FM_SPACER_SIZES.has(b.size) ? b.size : "md";
        return { type: "spacer", size };
      }
      if (b.type === "divider") return { type: "divider" };

      if (b.type === "heading") {
        const text = String(b.text || "");
        if (!text || PLACEHOLDER_RE.test(text)) return null;
        return {
          type: "heading",
          level: Math.min(Math.max(Number(b.level) || 1, 1), 3),
          text: text.slice(0, 300),
          align: FM_ALIGN.has(b.align) ? b.align : "center",
        };
      }

      if (b.type === "label-value") {
        const label = String(b.label || "").trim();
        const value = String(b.value || "").trim();
        // A label-value with an empty value is a placeholder in
        // disguise. Drop it entirely.
        if (!label || !value) return null;
        if (PLACEHOLDER_RE.test(value) || PLACEHOLDER_RE.test(label)) return null;
        return {
          type: "label-value",
          label: label.slice(0, 80),
          value: value.slice(0, 300),
          align: FM_ALIGN.has(b.align) ? b.align : "left",
        };
      }

      // default: text
      const text = String(b.text || "");
      if (!text || PLACEHOLDER_RE.test(text)) return null;
      return {
        type: "text",
        text: text.slice(0, 300),
        size: FM_TEXT_SIZES.has(b.size) ? b.size : "md",
        weight: b.weight === "bold" ? "bold" : "normal",
        align: FM_ALIGN.has(b.align) ? b.align : "center",
      };
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────
// Block cleanup helpers
// ─────────────────────────────────────────────────────────────────────
const normalizeHeadingText = (t) =>
  String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function dedupeSectionHeading(blocks, sectionHeading) {
  const target = normalizeHeadingText(sectionHeading);
  if (!target) return blocks;
  return blocks.filter((b) => {
    if (b?.type !== "heading") return true;
    return normalizeHeadingText(b.text) !== target;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Hard page-fit safety net
// ─────────────────────────────────────────────────────────────────────
const BLOCK_OVERHEAD_WORDS = {
  heading: 4,
  bulletItem: 5,
  divider: 3,
  quote: 3,
  code: 3,
};

const countWords = (s) =>
  String(s || "").trim().split(/\s+/).filter(Boolean).length;

const truncateToWords = (text, maxWords) => {
  if (maxWords <= 0) return "";
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ").replace(/[.,;:]+$/, "") + "…";
};

function capBlocksToWordBudget(blocks, maxWords) {
  if (!Array.isArray(blocks) || !Number.isFinite(maxWords) || maxWords <= 0) {
    return blocks || [];
  }

  const out = [];
  let used = 0;

  for (const b of blocks) {
    if (!b) continue;
    const remaining = maxWords - used;
    if (remaining <= 0) break;

    if (b.type === "heading") {
      const cost = countWords(b.text) + BLOCK_OVERHEAD_WORDS.heading;
      if (cost > remaining) break;
      out.push(b);
      used += cost;
      continue;
    }

    if (b.type === "bullets" || b.type === "numbered") {
      const items = Array.isArray(b.items) ? b.items : [];
      const kept = [];
      for (const item of items) {
        const cost = countWords(item) + BLOCK_OVERHEAD_WORDS.bulletItem;
        if (used + cost > maxWords) break;
        kept.push(item);
        used += cost;
      }
      if (kept.length) out.push({ ...b, items: kept });
      if (kept.length < items.length) break;
      continue;
    }

    if (b.type === "paragraph") {
      const words = countWords(b.text);
      if (words <= remaining) {
        out.push(b);
        used += words;
      } else {
        const trimmed = truncateToWords(b.text, remaining);
        if (trimmed) out.push({ ...b, text: trimmed });
        used = maxWords;
        break;
      }
      continue;
    }

    if (b.type === "quote" || b.type === "code") {
      const cost = countWords(b.text) + BLOCK_OVERHEAD_WORDS.quote;
      if (cost > remaining) break;
      out.push(b);
      used += cost;
      continue;
    }

    if (b.type === "divider") {
      if (BLOCK_OVERHEAD_WORDS.divider > remaining) break;
      out.push(b);
      used += BLOCK_OVERHEAD_WORDS.divider;
      continue;
    }

    out.push(b);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Optional packages
// ─────────────────────────────────────────────────────────────────────
let mammoth, pdfParse;
try { mammoth = (await import("mammoth")).default; } catch { mammoth = null; }
try { pdfParse = (await import("pdf-parse")).default; } catch { pdfParse = null; }

// ─────────────────────────────────────────────────────────────────────
// Form lookup heuristic
// ─────────────────────────────────────────────────────────────────────
const FORM_LOOKUP_RE =
  /\b(my|the)\s+(forms?|quizzes|quiz|surveys?|exams?|tests?|polls?|assessments?|feedback|questionnaires?|responses?|submissions?|elections?|votes?|ballots?)\b|\b(stats?|responses?|submissions?|leaderboard|scores?|results?|standings?|analytics?)\s+(on|for|of|from)\b|\bhow many (forms?|responses?|submissions?|people|entries|answers|votes?)\b|\blist my\b|\bshow me my\b|\bwhat('s| is| are) on my\b|\bhow did people\b|\bwho (submitted|filled|answered|responded|voted)\b|\bhow many (people )?(filled|finished|completed|submitted|voted)\b|\baverage score\b|\bpass rate\b|\btop scores?\b|\bwho('s| is) winning\b|\bcurrent (standings?|results?)\b/i;

const FORM_STATS_INTENT_RE =
  /\b(stats?|statistics|responses?|submissions?|leaderboard|scores?|results?|standings?|analytics?|average|pass rate|how many|who (submitted|filled|answered|responded|voted)|who('s| is) winning)\b/i;

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

const toHistory = (messages, limit = HISTORY_MAX_MESSAGES) =>
  messages
    .slice(-limit)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").slice(0, HISTORY_MAX_CHARS_PER_MESSAGE),
    }));

const capForClassifier = (message, history) => ({
  message: String(message || "").slice(0, CLASSIFIER_MESSAGE_CHAR_CAP),
  history: history.slice(-CLASSIFIER_HISTORY_TURNS).map((m) => ({
    role: m.role,
    content: String(m.content || "").slice(0, CLASSIFIER_HISTORY_CHARS),
  })),
});

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

  return sections.join("\n\n").slice(0, MEMORY_BLOCK_MAX_CHARS);
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

// ═════════════════════════════════════════════════════════════════════
// DOCUMENT GENERATION — blueprint-driven
// ═════════════════════════════════════════════════════════════════════

async function planDocumentBlueprint({
  topic, instructions, style, targetPages,
  wordsPerPage, sectionCount, wordsPerSection, fontSettings, report,
}) {
  report("Designing the document");

  const blueprint = await groqJSON({
    messages: [
      {
        role: "system",
        content: `You are a document architect. You plan the ENTIRE shape of a document before any of it is written.

You decide, from the user's request:
  1. What kind of document this is.
  2. Whether it needs a FRONT PAGE (title page / cover page).
  3. If yes, what goes on it and IN WHAT ORDER — top to bottom.
  4. Whether it needs a TABLE OF CONTENTS.
  5. The sections, each with its own format hint.
  6. Whether it needs a CLOSING page.

════════════════════════════════════════════════════════════════
RULE 1 — FRONT MATTER IS OFF BY DEFAULT. READ THIS TWICE.
════════════════════════════════════════════════════════════════
"frontMatter.enabled" must be FALSE unless the user's request is
CLEARLY one of these:
  • an academic deliverable: assignment, essay, term paper, thesis,
    dissertation, research paper, case study, lab report, project work
  • a business / professional deliverable: report, proposal, business
    plan, white paper, briefing, formal memo
  • the user EXPLICITLY asked for one: "with a cover page", "add a
    title page", "I need a cover"

For EVERYTHING ELSE — explainers, "how does X work", "tell me about X",
study notes, summaries, guides, tutorials, letters, quick write-ups,
casual articles, anything short, anything that just answers a
question — frontMatter.enabled is FALSE. Don't think about it. Turn
it off.

When in doubt, FALSE.

════════════════════════════════════════════════════════════════
RULE 2 — NEVER INVENT PLACEHOLDER TEXT.
════════════════════════════════════════════════════════════════
The user did NOT give you their name, matric number, course code,
department, or date. Do NOT write "[Your Name]", "[Student Name]",
"[Date]", "[Course Code]", "[University]", "Name:", or any other
bracketed placeholder. It looks broken and users hate it.

If the user didn't provide a value, DON'T include a block for it.
Only put a "label-value" block on the front matter when the value
comes from the request itself.

If front matter is enabled and you have nothing real to put on it
beyond the title, then either:
  • put just the title (centered) and nothing else, OR
  • turn front matter off entirely.

════════════════════════════════════════════════════════════════
RULE 3 — TABLE OF CONTENTS IS ALSO OFF BY DEFAULT.
════════════════════════════════════════════════════════════════
Turn it on ONLY when the document has 5 or more sections AND it's
one of the formal kinds above. Otherwise FALSE.

════════════════════════════════════════════════════════════════
FRONT MATTER — HOW TO BUILD IT WHEN YOU DO ENABLE IT
════════════════════════════════════════════════════════════════
Front matter is a freestanding ORDERED list of blocks. The order is
the layout — first block is at the top, last block is at the bottom.

Available block types:
  - { "type": "text", "text": "...", "size": "sm|md|lg|xl|2xl", "weight": "normal|bold", "align": "left|center|right" }
  - { "type": "heading", "text": "...", "level": 1|2|3, "align": "left|center|right" }
  - { "type": "label-value", "label": "Student Name", "value": "Jane Doe", "align": "left|center|right" }
  - { "type": "spacer", "size": "sm|md|lg|xl" }
  - { "type": "divider" }

Use spacers to push content to the top / middle / bottom. A typical
academic cover looks like:
  [top]    University / course line (small)
  [spacer]
  [middle] Title (heading level 1, centered)
  [spacer]
  [bottom] Student name / ID / date — ONLY if the user gave them

If the user gave you their name, use it. If they didn't, leave that
row out.

════════════════════════════════════════════════════════════════
SECTION FORMAT HINTS — one per section.
════════════════════════════════════════════════════════════════
  - "prose"    — flowing paragraphs, no lists
  - "mixed"    — some prose, maybe a bullet list where it earns its place
  - "bullets"  — mostly a bullet list
  - "steps"    — numbered steps
  - "qa"       — question / answer pairs
  - "list"     — a flat list of items with short prose leads
  - "dialogue" — conversational exchange

Match the format to what the section actually needs. A method
section is prose. A procedure is steps. A comparison is a list.
An explainer is usually "prose" or "mixed".

════════════════════════════════════════════════════════════════
CLOSING — almost always FALSE.
════════════════════════════════════════════════════════════════
Only set closing.enabled = true for reports or speeches that need a
signature line, acknowledgement block, or "thank you for reading".
For a plain document, closing is FALSE.

Return STRICT JSON only.`,
      },
      {
        role: "user",
        content: `Request:
${topic}

Extra instructions: ${instructions || "none"}
Style: ${style}
Target length: ~${targetPages} A4 pages at ${fontSettings.bodyFontSize}pt / ${fontSettings.lineSpacing} spacing.
Aim for about ${sectionCount} sections, roughly ${wordsPerSection} words each. You may adjust.

Return JSON exactly:
{
  "kind": "assignment|essay|letter|report|memo|notes|guide|manual|article|proposal|speech|bio|summary|study-guide|story|tutorial|other",
  "title": "string",
  "subtitle": "string or empty",
  "author": "string or empty",
  "frontMatter": {
    "enabled": boolean,
    "blocks": [ ...front matter blocks in top-to-bottom order... ]
  },
  "tableOfContents": {
    "enabled": boolean,
    "title": "string (default 'Table of Contents')"
  },
  "sections": [
    {
      "heading": "string",
      "brief": "one sentence describing what this section covers",
      "format": "prose|mixed|bullets|steps|qa|list|dialogue"
    }
  ],
  "closing": {
    "enabled": boolean,
    "heading": "string or empty",
    "blocks": [ ...optional closing blocks, same shape as front matter... ]
  }
}
No markdown, no code fences, no commentary.`,
      },
    ],
    temperature: 0.7,
    maxTokens: 1600,
  });

  return blueprint;
}

async function generateDocumentContent({
  userId, conversationId, topic, instructions = "", style = "academic",
  length = "medium", pageCount,
  fontSize, lineSpacing, fontFamily,
  includeCoverPage,
  includeTableOfContents,
  templateId, primaryColor, secondaryColor,
  sourcePrompt = "", onStatus,
}) {
  const report = typeof onStatus === "function" ? onStatus : () => {};

  const fontSettings = buildFontSettings({ fontSize, lineSpacing, fontFamily });

  const lengthPages = { short: 3, medium: 6, long: 12 }[length] || 6;
  const targetPages =
    Number.isFinite(+pageCount) && +pageCount > 0
      ? Math.min(Math.max(Math.round(+pageCount), 1), 40)
      : lengthPages;

  const wordsPerPage = computeWordsPerPage(fontSettings);
  const bodyGuess = Math.max(targetPages - 1, 1);
  const targetBodyWords = bodyGuess * wordsPerPage;

  const sectionCount = Math.min(Math.max(Math.round(bodyGuess * 1.2), 3), 14);
  const wordsPerSection = Math.max(Math.round(targetBodyWords / sectionCount), 120);

  const pageWordBudget = Math.max(Math.round(wordsPerPage * 0.9), 100);

  // ── PHASE 1 — architect ────────────────────────────────────────
  let bp;
  try {
    bp = await planDocumentBlueprint({
      topic,
      instructions,
      style,
      targetPages,
      wordsPerPage,
      sectionCount,
      wordsPerSection,
      fontSettings,
      report,
    });
  } catch (err) {
    console.warn(
      "⚠️ Blueprint phase failed, falling back to minimal shape:",
      err.message
    );
    bp = null;
  }

  // ── Decide front matter for real ───────────────────────────────
  // Precedence:
  //   1. User explicitly told the classifier (includeCoverPage is a
  //      boolean) → obey them exactly.
  //   2. Prompt literally says "cover page" / "title page" → on.
  //   3. (Optional, off by default) Formal doc + architect said yes.
  //   4. Otherwise → OFF, regardless of what the architect emitted.
  const promptBlob = `${topic} ${instructions || ""}`;
  const explicitCover = EXPLICIT_COVER_RE.test(promptBlob);
  const looksFormal = FORMAL_DOC_RE.test(promptBlob);

  const frontMatterEnabled =
    typeof includeCoverPage === "boolean"
      ? includeCoverPage
      : explicitCover ||
        (COVER_FOR_FORMAL_DOCS && looksFormal && bp?.frontMatter?.enabled === true);

  // TOC only makes sense on long formal docs, and only when the user
  // explicitly asked or the doc is formal.
  const tocEnabled =
    typeof includeTableOfContents === "boolean"
      ? includeTableOfContents
      : looksFormal && bp?.tableOfContents?.enabled === true;

  const blueprint = {
    kind: bp?.kind || "document",
    title: bp?.title || topic,
    subtitle: bp?.subtitle || "",
    author: bp?.author || "Xamut",
    frontMatter: {
      enabled: frontMatterEnabled,
      blocks: frontMatterEnabled
        ? sanitizeFrontMatterBlocks(bp?.frontMatter?.blocks || [])
        : [],
    },
    tableOfContents: {
      enabled: tocEnabled,
      title: bp?.tableOfContents?.title || "Table of Contents",
    },
    sections:
      Array.isArray(bp?.sections) && bp.sections.length
        ? bp.sections
        : [{ heading: topic, brief: "Cover the topic.", format: "prose" }],
    closing: {
      enabled: looksFormal && bp?.closing?.enabled === true,
      heading: bp?.closing?.heading || "",
      blocks:
        looksFormal && bp?.closing?.enabled === true
          ? sanitizeFrontMatterBlocks(bp?.closing?.blocks || [])
          : [],
    },
  };

  // ── PHASE 2 — build pages ──────────────────────────────────────
  const pages = [];

  if (blueprint.frontMatter.enabled) {
    pages.push({
      role: "cover",
      heading: blueprint.title,
      subheading: blueprint.subtitle,
      paragraphs: [],
      bullets: [],
      blocks: blueprint.frontMatter.blocks,
      notes: "",
    });
  }

  if (blueprint.tableOfContents.enabled && blueprint.sections.length >= 3) {
    pages.push({
      role: "toc",
      heading: blueprint.tableOfContents.title,
      subheading: "",
      paragraphs: [],
      bullets: [],
      blocks: blueprint.sections.map((s) => ({
        type: "toc-entry",
        text: s.heading,
        level: 1,
        style: { fontSize: fontSettings.bodyFontSize },
      })),
      notes: "",
    });
  }

  for (let idx = 0; idx < blueprint.sections.length; idx++) {
    const s = blueprint.sections[idx];
    report(`Writing section ${idx + 1} of ${blueprint.sections.length}`);

    const fmt = SECTION_FORMATS.has(s.format) ? s.format : "mixed";
    const formatDirective = buildFormatDirective(fmt);

    const body = await groqJSON({
      messages: [
        {
          role: "system",
          content:
            "You write one section of a document at a time. Return STRICT JSON only.",
        },
        {
          role: "user",
          content: `Document kind: ${blueprint.kind}
Document title: ${blueprint.title}
Section heading: ${s.heading}
What this section should cover: ${s.brief || ""}
Target length: about ${wordsPerSection} words. Do not significantly exceed this — it needs to fit on one A4 page.
Style: ${style}

${RICH_RULES}

${formatDirective}

Never repeat the section's own title as a heading block — it's already rendered above the body.

Return JSON exactly:
{
  "blocks": [
    { "type": "paragraph", "text": "..." },
    { "type": "heading", "level": 2, "text": "..." },
    { "type": "bullets", "items": ["...", "..."] },
    { "type": "numbered", "items": ["...", "..."] }
  ]
}
Only the four block types above.`,
        },
      ],
      temperature: 0.65,
      maxTokens: 2400,
    });

    const deduped = dedupeSectionHeading(
      Array.isArray(body.blocks) ? body.blocks : [],
      s.heading
    );
    const blocks = capBlocksToWordBudget(deduped, pageWordBudget);

    pages.push({
      role: "section",
      heading: s.heading,
      subheading: "",
      paragraphs: [],
      bullets: [],
      blocks,
      notes: "",
    });
  }

  if (blueprint.closing.enabled && blueprint.closing.blocks.length) {
    pages.push({
      role: "closing",
      heading: blueprint.closing.heading || "",
      subheading: "",
      paragraphs: [],
      bullets: [],
      blocks: blueprint.closing.blocks,
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

  return await Document.create({
    user: userId,
    conversation: conversationId || null,
    type: "document",
    kind: blueprint.kind,
    title: blueprint.title,
    subtitle: blueprint.subtitle,
    author: blueprint.author,
    pages,
    theme,
    fontSettings,
    pageCount: targetPages,
    includeCoverPage: blueprint.frontMatter.enabled,
    includeTableOfContents: blueprint.tableOfContents.enabled,
    sourcePrompt,
    status: "ready",
  });
}

// ─────────────────────────────────────────────────────────────────────
// Presentation generator — untouched behavior
// ─────────────────────────────────────────────────────────────────────
async function generatePresentationContent({
  userId, conversationId, topic, instructions = "", slides = 10,
  companyName = "", includeTableOfContents = null,
  templateId, primaryColor, secondaryColor,
  sourcePrompt = "", onStatus,
}) {
  const report = typeof onStatus === "function" ? onStatus : () => {};
  const totalSlides = Math.min(Math.max(Number(slides) || 10, 4), 30);

  const innerBudget = totalSlides - 2;
  const wantToc =
    includeTableOfContents === true ||
    (includeTableOfContents !== false && innerBudget >= 6);
  const contentSlides = Math.max(innerBudget - (wantToc ? 1 : 0), 2);

  report("Planning the slide structure");

  const outline = await groqJSON({
    messages: [
      { role: "system", content: "You are a presentation architect. Return STRICT JSON only." },
      {
        role: "user",
        content: `Plan a presentation about: ${topic}.
Extra instructions: ${instructions || "none"}
Produce exactly ${contentSlides} CONTENT slides.
Cover${wantToc ? ", agenda," : ""} and closing slides are added separately.
Each content slide: 3-5 short bullets, 5-8 words per bullet.
Slides are glanceable, not paragraphs.

Return JSON exactly:
{
  "title": "string",
  "subtitle": "string",
  "slides": [
    { "title": "string", "brief": "one sentence on what this slide should cover" }
  ]
}
No markdown, no code fences, no commentary.`,
      },
    ],
    temperature: 0.6,
    maxTokens: 900,
  });

  const pages = [];

  pages.push({
    role: "cover",
    heading: outline.title || topic,
    subheading: outline.subtitle || "",
    paragraphs: [],
    bullets: [],
    blocks: [],
    notes: "",
  });

  if (wantToc) {
    pages.push({
      role: "toc",
      heading: "Agenda",
      subheading: "",
      paragraphs: [],
      bullets: [],
      blocks: (outline.slides || []).map((s) => ({
        type: "toc-entry",
        text: s.title,
        level: 1,
      })),
      notes: "",
    });
  }

  const slideList = outline.slides || [];
  for (let idx = 0; idx < slideList.length; idx++) {
    const s = slideList[idx];
    report(`Writing slide ${idx + 1} of ${slideList.length}`);

    const body = await groqJSON({
      messages: [
        {
          role: "system",
          content: "You write the content for one slide. Return STRICT JSON only.",
        },
        {
          role: "user",
          content: `Presentation topic: ${topic}
Slide title: ${s.title}
What this slide should cover: ${s.brief || ""}

${RICH_RULES}

Return JSON exactly:
{ "bullets": ["...", "..."], "notes": "1-2 sentence speaker note" }
3-5 bullets, 5-8 words each. Phrases, not sentences. No markdown headers.`,
        },
      ],
      temperature: 0.6,
      maxTokens: 400,
    });

    pages.push({
      role: "content",
      heading: s.title,
      subheading: "",
      paragraphs: [],
      bullets: (body.bullets || []).slice(0, 5),
      blocks: [],
      notes: body.notes || "",
    });
  }

  pages.push({
    role: "closing",
    heading: "Thank You",
    subheading: companyName || outline.title || topic,
    paragraphs: [],
    bullets: [],
    blocks: [],
    notes: "",
  });

  report("Assembling the presentation");

  const theme = resolveTheme({ type: "presentation", templateId, primaryColor, secondaryColor });

  return await Document.create({
    user: userId,
    conversation: conversationId || null,
    type: "presentation",
    title: outline.title || topic,
    subtitle: outline.subtitle || "",
    author: "Xamut",
    companyName: companyName || "",
    pages,
    theme,
    fontSettings: buildFontSettings({}),
    pageCount: pages.length,
    includeCoverPage: true,
    includeTableOfContents: wantToc,
    sourcePrompt,
    status: "ready",
  });
}

// ─────────────────────────────────────────────────────────────────────
// Generation intent detection
// ─────────────────────────────────────────────────────────────────────
async function detectGenerationIntent({ message, history, forceType = null }) {
  const capped = capForClassifier(message, history);

  const recent = capped.history
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
1. "document" — essay, report, chapter, thesis, paper, assignment, letter,
   article, proposal, memo, brief, notes, summary, study guide, review,
   analysis, write-up. Any prose deliverable that reads as pages.
2. "presentation" — slide deck, slides, slideshow, pitch deck, keynote, PPT.
3. "form" — anything people fill in and send back.

${FORM_INTENT_FEATURE_LIST}

=== LOOKUPS ARE NOT GENERATION (read this too) ===

Do NOT set "form" when the user is asking about a form that ALREADY
EXISTS. Possessive markers ("my form", "my quiz", "my attendance form",
"the survey I made") and retrieval markers ("stats", "how many", "list",
"show me", "responses", "submissions", "leaderboard", "scores",
"results", "average", "pass rate", "who submitted") mean the user
wants a lookup, not a creation. Set wantsGeneration = false.

=== RULES ===

- NEVER set "presentation" unless a presentation word appears.
- Check the LOOKUP rules before defaulting to "form".
- If no signal words appear:
    - academic or school topic → "document"
    - business pitch or talk → "presentation"
    - anything else → "document"
- If the request is just chatting, advice, personal questions, or
  "who is X", set wantsGeneration = false.

=== EXTRACTION DETAILS ===

- pageCount: if the user says "5 pages", "a 10-page report", "3 pages
  long", set pageCount to that integer. DOCUMENTS ONLY. Never set
  pageCount for a presentation.
- slideCount: if the user says "8 slides", "12-slide deck", set
  slideCount. PRESENTATIONS ONLY. Never set slideCount for a document.
- fontSize: only set when the user explicitly mentions body font size
  ("12pt", "14 point", "bigger font", "smaller font"). Map "bigger"
  to 14 and "smaller" to 10. Default is 12, so leave null otherwise.
- lineSpacing: "single spaced" → 1.0, "1.5 spaced" → 1.5,
  "double spaced" → 2.0. Any value 1.0-2.0 is valid. Default is 1.5,
  so leave null unless the user says something.

- includeCoverPage: ONLY set this when the user EXPLICITLY says
  something about a cover / front / title page. "with a cover", "add
  a cover page", "I need a title page" → true. "no cover", "skip the
  cover", "no front page" → false. Anything else → null. The system
  will NOT add a cover page unless this field is explicitly true, so
  do not set it based on guessing what kind of document this is.

- includeTableOfContents: ONLY set this when the user EXPLICITLY
  mentions a table of contents / TOC / contents / agenda. "add a
  TOC", "with a table of contents" → true. "no TOC", "no table of
  contents", "skip the contents page", "straight up, no TOC" → false.
  Anything else → null.

- instructions: capture ANY formatting, structure, or style request the
  user gives — "add bullet points", "use subheadings", "emphasize key
  terms", "add my name is Jane", "more formal tone", "name at the top
  and title in the middle", "just write it like a letter". Preserve
  their actual wording where possible instead of paraphrasing it away.
  This is the single most important field for making the output
  dynamic — don't drop anything from it.

Return STRICT JSON only.`,
        },
        {
          role: "user",
          content: `Recent conversation:
${recent || "(none)"}

Latest user message:
${capped.message}

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
  "pageCount": number or null,
  "slideCount": number or null,
  "fontSize": number or null,
  "lineSpacing": number or null,
  "includeCoverPage": boolean or null,
  "includeTableOfContents": boolean or null,
  "templateId": "string or null",
  "primaryColor": "string or null",
  "secondaryColor": "string or null"
}`,
        },
      ],
      temperature: 0,
      maxTokens: 600,
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
  const capped = capForClassifier(message, history);

  const recent = capped.history
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
${capped.message}`,
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
  user, conversationId, message, agent, attachments, context,
  forceType, onStatus,
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

  const cleanAttachments = (attachments || [])
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({
      type: a.type,
      url: a.url || "",
      name: a.name || "",
      mimeType: a.mimeType || "",
      extractedText: (a.extractedText || "").slice(0, MAX_DOC_TEXT_CHARS),
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

  const history = toHistory(convo.messages.slice(0, -1));

  const images = cleanAttachments.filter((a) => a.type === "image");
  const docs = cleanAttachments.filter(
    (a) => a.type === "document" && a.extractedText
  );

  let effectiveText = trimmed;
  if (docs.length) {
    const docBlock = docs
      .map((d, i) =>
        `--- Attached document ${i + 1}: ${d.name || "document"} ---\n${d.extractedText}`
      )
      .join("\n\n")
      .slice(0, MAX_DOC_BLOCK_CHARS);
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
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const worthClassifying = trimmed.length >= 6 && wordCount >= 2;

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

    // ── Forced form lookup ─────────────────────────────────────
    if (looksLikeFormLookup && !images.length && !docs.length && trimmed) {
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

    // ── Forced research lookup ─────────────────────────────────
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

    // ── Generation ─────────────────────────────────────────────
    if (intent.wantsGeneration && intent.readyToGenerate && intent.topic) {
      // FORM
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
            const allFields = session.draft.fields || [];
            const fieldCount = allFields.filter((f) => f.type !== "section").length;
            const mediaFields = allFields.filter((f) => FORM_MEDIA_TYPES.has(f.type));
            const redirect = session.draft.settings?.successRedirectUrl || "";

            const lines = [];
            lines.push(
              `Built a draft with **${fieldCount}** question${
                fieldCount === 1 ? "" : "s"
              }. Look it over, then tap create.`
            );

            if (mediaFields.length) {
              const kinds = new Set(
                mediaFields.map((f) =>
                  f.type === "image"
                    ? "photos"
                    : f.type === "document"
                    ? "documents"
                    : "files"
                )
              );
              lines.push(
                `It includes **${mediaFields.length}** upload field${
                  mediaFields.length === 1 ? "" : "s"
                } — respondents will be able to attach ${[...kinds].join(
                  " and "
                )} directly.`
              );
            }

            if (redirect) {
              lines.push(`Redirect after submit is set to \`${redirect}\`.`);
            }

            lines.push(
              [
                `Two things you can also set up for this form:`,
                `- **Cover photo** — a poster or banner at the top. Upload it from the editor once the form is created.`,
                `- **Redirect link** — send people to a WhatsApp group, Telegram, or your website after they submit.`,
              ].join("\n")
            );

            lines.push(
              redirect
                ? `Want a different redirect URL, or a cover photo? Just say so.`
                : `Want to add a redirect link? Tell me the URL and I'll set it.`
            );

            reply = lines.join("\n\n");
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

      // PRESENTATION
      else if (intent.type === "presentation") {
        const built = await generatePresentationContent({
          userId: user._id,
          conversationId: convo._id,
          topic: intent.topic,
          instructions: intent.instructions || "",
          slides: intent.slideCount || 10,
          companyName: intent.companyName || "",
          includeTableOfContents:
            typeof intent.includeTableOfContents === "boolean"
              ? intent.includeTableOfContents
              : null,
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

      // DOCUMENT
      else if (intent.type === "document") {
        const built = await generateDocumentContent({
          userId: user._id,
          conversationId: convo._id,
          topic: intent.topic,
          instructions: intent.instructions || "",
          style: intent.style || "academic",
          length: intent.length || "medium",
          pageCount: intent.pageCount || undefined,
          fontSize: intent.fontSize || undefined,
          lineSpacing: intent.lineSpacing || undefined,
          includeCoverPage:
            typeof intent.includeCoverPage === "boolean"
              ? intent.includeCoverPage
              : undefined,
          includeTableOfContents:
            typeof intent.includeTableOfContents === "boolean"
              ? intent.includeTableOfContents
              : undefined,
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
          targetPages: built.pageCount,
          templateId: built.theme.templateId,
        });

        const pagesWord = built.pageCount === 1 ? "page" : "pages";
        reply = `Done. **${built.title}**, about ${built.pageCount} ${pagesWord} at ${built.fontSettings.bodyFontSize}pt. Tap to open and download.`;
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
          const refine = await runSmartTurn({
            systemPrompt,
            history,
            userContent: `User question: ${trimmed}\n\nWhat you saw in the image(s):\n${reply}\n\nGive the final answer.`,
            onStatus: report,
            userId: user._id,
          });
          reply = refine.content || reply;
          usedModel = refine.model;
          replyImages.push(...(refine.images || []));
          replyImageSources.push(...(refine.imageSources || []));
          replyWhereToFind.push(...(refine.whereToFind || []));
        }
      } else {
        console.log(
          `[turn] sys=${estimateTokens(systemPrompt)}t hist=${estimateTokens(history)}t user=${estimateTokens(effectiveText)}t`
        );

        const turn = await runSmartTurn({
          systemPrompt,
          history,
          userContent: effectiveText || "(no message)",
          onStatus: report,
          userId: user._id,
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
      } catch {
        /* never surface memory errors */
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
      extractedText: extractedText.slice(0, MAX_DOC_TEXT_CHARS),
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
    conversationId, message = "", agent = "chat",
    attachments = [], context, forceType,
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
      conversationId, message = "", agent = "chat",
      attachments = [], context, forceType,
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
  const {
    topic, instructions, style, length,
    pageCount, fontSize, lineSpacing, fontFamily,
    includeCoverPage, includeTableOfContents,
    templateId, primaryColor, secondaryColor,
  } = req.body || {};
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
    pageCount,
    fontSize,
    lineSpacing,
    fontFamily,
    includeCoverPage:
      typeof includeCoverPage === "boolean" ? includeCoverPage : undefined,
    includeTableOfContents:
      typeof includeTableOfContents === "boolean"
        ? includeTableOfContents
        : undefined,
    templateId,
    primaryColor,
    secondaryColor,
    sourcePrompt: topic,
  });
  res.status(201).json({ success: true, document: doc.toSummary() });
});

export const generatePresentation = asyncHandler(async (req, res) => {
  const {
    topic, instructions, slides, companyName,
    includeTableOfContents,
    templateId, primaryColor, secondaryColor,
  } = req.body || {};
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
    includeTableOfContents:
      typeof includeTableOfContents === "boolean" ? includeTableOfContents : null,
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