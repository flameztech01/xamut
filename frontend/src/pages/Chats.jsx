// pages/Chat.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useListConversationsQuery,
  useGetConversationQuery,
  useDeleteConversationMutation,
  useUploadAttachmentMutation,
  aiApiSlice,
} from "../features/aiApiSlice";
import {
  useGetFormAiSessionQuery,
  useAnswerFormAiQuestionMutation,
  useRegenerateFormAiDraftMutation,
  useConfirmFormAiSessionMutation,
  useCancelFormAiSessionMutation,
} from "../features/formAiApiSlice";
import { useChatStream } from "../features/useChatStream";
import { useLogoutMutation } from "../features/userApiSlice";
import { logout as logoutAction } from "../features/auth/authSlice";
import { useTheme } from "../context/ThemeContext";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const MAX_FORM_QUESTIONS = 3;

const FORM_LOOKUP_RE =
  /\b(my|the)\s+(forms?|quizzes|quiz|surveys?|exams?|tests?|polls?|assessments?|feedback|questionnaires?|responses?|submissions?)\b|\b(stats?|responses?|submissions?|leaderboard|scores?|results?|analytics?)\s+(on|for|of|from)\b|\bhow many (forms?|responses?|submissions?|people|entries|answers)\b|\blist my\b|\bshow me my\b|\bwhat('s| is| are) on my\b|\bhow did people\b|\bwho (submitted|filled|answered|responded)\b|\bhow many (people )?(filled|finished|completed|submitted)\b|\baverage score\b|\bpass rate\b|\btop scores?\b/i;

const AGENTS = [
  { id: "chat", label: "Chat", hint: "General help" },
  { id: "coding", label: "Code", hint: "Write & debug code" },
  { id: "writer", label: "Scholar", hint: "Writing & essays" },
  { id: "research", label: "Research", hint: "Deep web research" },
];

const SUGGESTIONS = [
  {
    tag: "Explain",
    text: "Explain photosynthesis like I'm 10",
    desc: "Break a tricky topic down into plain language",
  },
  {
    tag: "Chapter",
    text: "Write chapter 1 of my project on renewable energy",
    desc: "Draft long-form writing section by section",
  },
  {
    tag: "Slides",
    text: "Make me a 10-slide presentation on renewable energy",
    desc: "Turn an idea into a structured slide outline",
  },
  {
    tag: "Ideas",
    text: "Give me 5 startup ideas in the AI space",
    desc: "Brainstorm options fast, then narrow down",
  },
];

const DAY = 86_400_000;

const FIELD_LABEL = {
  short_text: "Short answer",
  long_text: "Paragraph",
  email: "Email",
  number: "Number",
  date: "Date",
  time: "Time",
  url: "URL",
  phone: "Phone",
  radio: "Choice",
  checkbox: "Checkboxes",
  dropdown: "Dropdown",
  multi_select: "Multi-select",
  rating: "Rating",
  scale: "Scale",
  yes_no: "Yes / No",
  file: "File",
  section: "Section",
};

// ─────────────────────────────────────────────────────────────
// Content preprocessing
// ─────────────────────────────────────────────────────────────
const CITATION_RE = /【[^】]*】/g;

const LINKIFY_TLD =
  "com|org|net|io|dev|app|site|co|edu|gov|xyz|info|me|ai|tech|blog|live|online|tv|fm|gg|to|sh|page|studio|space|website|store|club";
const BARE_DOMAIN_RE = new RegExp(
  `(?<![([\\w@:/.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${LINKIFY_TLD})(?:\\/[^\\s)\\]<>"']*)?)`,
  "gi"
);

const linkifyBareDomains = (text) =>
  text.replace(BARE_DOMAIN_RE, (match) => {
    const trailing = match.match(/[.,;:!?]+$/);
    if (trailing) {
      const clean = match.slice(0, -trailing[0].length);
      return `[${clean}](https://${clean})${trailing[0]}`;
    }
    return `[${match}](https://${match})`;
  });

const preprocessContent = (text) => {
  if (!text) return "";
  let out = text.replace(CITATION_RE, "");
  const segments = out.split(/(```[\s\S]*?```)/g);
  out = segments
    .map((seg, i) => (i % 2 === 1 ? seg : linkifyBareDomains(seg)))
    .join("");
  out = out
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
};

// ─────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────
const formatTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const getDomain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const groupConversations = (list) => {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const buckets = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Older", items: [] },
  ];

  list.forEach((c) => {
    const raw = c.updatedAt || c.createdAt;
    const t = raw ? new Date(raw).getTime() : NaN;
    if (Number.isNaN(t) || t >= startOfToday) buckets[0].items.push(c);
    else if (t >= startOfToday - DAY) buckets[1].items.push(c);
    else if (t >= startOfToday - 7 * DAY) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  });

  return buckets.filter((b) => b.items.length > 0);
};

// ─────────────────────────────────────────────────────────────
// Brand marks
// ─────────────────────────────────────────────────────────────
const XamutMark = ({ className = "h-9 w-9" }) => (
  <div
    className={`${className} flex shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-teal-400 via-teal-500 to-teal-600 shadow-sm shadow-teal-500/30`}
  >
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-white">
      <path
        fill="currentColor"
        d="M6 5h3.2L12 9.3 14.8 5H18l-4.5 6.4L18.5 19H15.3L12 14.2 8.7 19H5.5L10 12.2 6 5Z"
      />
    </svg>
  </div>
);

const XamutAvatar = ({ size = "md" }) => {
  const dims = size === "sm" ? "h-6 w-6 sm:h-7 sm:w-7" : "h-7 w-7 sm:h-8 sm:w-8";
  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 shadow-sm shadow-teal-500/25 ring-2 ring-white dark:ring-stone-900`}
    >
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-white">
        <path
          fill="currentColor"
          d="M6 5h3.2L12 9.3 14.8 5H18l-4.5 6.4L18.5 19H15.3L12 14.2 8.7 19H5.5L10 12.2 6 5Z"
        />
      </svg>
    </div>
  );
};

const XamutOrb = ({ size = 72 }) => (
  <div
    className="relative shrink-0 rounded-full shadow-lg shadow-teal-500/25"
    style={{
      width: size,
      height: size,
      background:
        "radial-gradient(circle at 32% 28%, #5eead4 0%, #14b8a6 45%, #0f766e 100%)",
    }}
  >
    <div
      className="absolute rounded-full bg-white/40 blur-[2px]"
      style={{
        width: size * 0.28,
        height: size * 0.18,
        top: size * 0.18,
        left: size * 0.22,
      }}
    />
  </div>
);

const UserAvatar = ({ userInfo, size = "md" }) => {
  const dims =
    size === "sm"
      ? "h-7 w-7 text-[10px] sm:h-8 sm:w-8 sm:text-[11px]"
      : "h-9 w-9 text-xs";
  const initial = (userInfo?.name || "U").charAt(0).toUpperCase();
  const photo = userInfo?.profilePhoto || userInfo?.profile;

  if (photo) {
    return (
      <img
        src={photo}
        alt={userInfo?.name || "You"}
        className={`${dims} shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-stone-900`}
      />
    );
  }
  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-stone-900 font-semibold text-white dark:bg-stone-100 dark:text-stone-900`}
    >
      {initial}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const IconForms = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path
      d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSparkle = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path
      d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9L19 17z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconClose = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

const IconCheck = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={className}>
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
  </svg>
);

const IconArrowRight = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconPaperclip = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path
      d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSend = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconSun = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <circle cx="12" cy="12" r="4" />
    <path
      d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
      strokeLinecap="round"
    />
  </svg>
);

const IconMoon = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconMonitor = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" strokeLinecap="round" />
  </svg>
);

// ─────────────────────────────────────────────────────────────
// Theme toggle — 3-way segmented control for the sidebar
// ─────────────────────────────────────────────────────────────
const ThemeToggle = () => {
  const { mode, setMode } = useTheme();

  const OPTIONS = [
    { id: "light", label: "Light", Icon: IconSun },
    { id: "dark", label: "Dark", Icon: IconMoon },
    { id: "system", label: "System", Icon: IconMonitor },
  ];

  return (
    <div className="grid grid-cols-3 gap-0.5 rounded-xl border border-stone-200/70 bg-stone-50/70 p-0.5 dark:border-stone-800/70 dark:bg-stone-900/50">
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={active}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold leading-none transition-colors duration-150 ${
              active
                ? "bg-white text-teal-600 shadow-sm shadow-stone-900/[0.04] ring-1 ring-stone-900/5 dark:bg-stone-800 dark:text-teal-400 dark:ring-stone-100/5"
                : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Agent switch (desktop segmented control)
// ─────────────────────────────────────────────────────────────
const AgentSwitch = ({ agent, onChange, className = "" }) => {
  const index = Math.max(0, AGENTS.findIndex((a) => a.id === agent));

  return (
    <div
      className={`relative grid grid-cols-4 rounded-full bg-stone-100/80 p-1 dark:bg-stone-800/70 ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-white shadow-sm ring-1 ring-stone-900/5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] dark:bg-stone-700 dark:ring-stone-100/5"
        style={{
          width: "calc((100% - 0.5rem) / 4)",
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {AGENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onChange(a.id)}
          className={`relative z-10 rounded-full py-1.5 text-[12px] font-semibold transition-colors duration-200 ${
            agent === a.id
              ? "text-teal-600 dark:text-teal-400"
              : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Mobile agent picker
// ─────────────────────────────────────────────────────────────
const AgentPickerMobile = ({ agent, onChange }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const active = AGENTS.find((a) => a.id === agent) || AGENTS[0];

  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("touchstart", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("touchstart", handle);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold leading-none transition-colors active:scale-95 ${
          open
            ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-500/10 dark:text-teal-300"
            : "border-stone-200/80 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700/80 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800"
        }`}
      >
        <span className="h-1 w-1 rounded-full bg-teal-500 dark:bg-teal-400" />
        {active.label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          className={`h-2.5 w-2.5 text-stone-400 transition-transform duration-200 dark:text-stone-500 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-36 overflow-hidden rounded-xl border border-stone-200/80 bg-white py-0.5 shadow-xl shadow-stone-900/10 dark:border-stone-700/80 dark:bg-stone-900 dark:shadow-black/40">
          {AGENTS.map((a) => {
            const isActive = a.id === agent;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] leading-tight transition-colors ${
                  isActive
                    ? "bg-teal-50/80 font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                    : "text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800"
                }`}
              >
                <span
                  className={`h-1 w-1 shrink-0 rounded-full ${
                    isActive
                      ? "bg-teal-500 dark:bg-teal-400"
                      : "bg-stone-300 dark:bg-stone-600"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {isActive ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.8"
                    className="h-2.5 w-2.5 shrink-0 text-teal-500 dark:text-teal-400"
                  >
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Code block
// ─────────────────────────────────────────────────────────────
const CodeBlock = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-stone-800/80 bg-stone-950 dark:border-stone-800">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-stone-500">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-stone-400 transition-colors hover:bg-white/5 hover:text-stone-100"
        >
          {copied ? (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="h-3 w-3 text-teal-400"
              >
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-3 w-3"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="scrollbar-dark overflow-x-auto px-3.5 py-3 text-[12px] leading-relaxed text-stone-100 sm:px-4 sm:text-[12.5px]">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Markdown
// ─────────────────────────────────────────────────────────────
const markdownComponents = {
  p: ({ node, ...props }) => (
    <p className="mb-3 break-words leading-[1.7] last:mb-0" {...props} />
  ),
  h1: ({ node, ...props }) => (
    <h1
      className="mb-2 mt-5 text-[17px] font-semibold tracking-tight text-stone-900 first:mt-0 dark:text-stone-100 sm:text-[18px]"
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      className="mb-2 mt-5 text-[16px] font-semibold tracking-tight text-stone-900 first:mt-0 dark:text-stone-100 sm:text-[17px]"
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      className="mb-1.5 mt-4 text-[14.5px] font-semibold text-stone-900 first:mt-0 dark:text-stone-100"
      {...props}
    />
  ),
  h4: ({ node, ...props }) => (
    <h4
      className="mb-1.5 mt-3 text-sm font-semibold text-stone-900 first:mt-0 dark:text-stone-100"
      {...props}
    />
  ),
  ul: ({ node, ...props }) => (
    <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0" {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0" {...props} />
  ),
  li: ({ node, ...props }) => (
    <li
      className="break-words leading-[1.7] marker:text-stone-300 dark:marker:text-stone-600"
      {...props}
    />
  ),
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words font-medium text-teal-600 underline decoration-teal-300 decoration-1 underline-offset-2 transition-colors hover:text-teal-700 hover:decoration-teal-500 dark:text-teal-400 dark:decoration-teal-500/60 dark:hover:text-teal-300 dark:hover:decoration-teal-400"
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ node, ...props }) => (
    <strong className="font-semibold text-stone-900 dark:text-stone-100" {...props} />
  ),
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-3.5 rounded-r-lg border-l-2 border-teal-400 bg-teal-50/50 py-2 pl-4 pr-3 text-stone-600 dark:border-teal-500/60 dark:bg-teal-500/10 dark:text-stone-300"
      {...props}
    />
  ),
  hr: () => (
    <hr className="my-5 border-stone-200/80 dark:border-stone-800/80" />
  ),
  code: ({ node, inline, className, children, ...props }) => {
    const isBlock = /language-/.test(className || "");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="break-words rounded-md border border-stone-200/70 bg-stone-100/80 px-1.5 py-0.5 font-mono text-[0.85em] text-teal-700 dark:border-stone-700/70 dark:bg-stone-800/80 dark:text-teal-300"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ node, children, ...props }) => {
    const child = Array.isArray(children) ? children[0] : children;
    const code = child?.props?.children || "";
    const className = child?.props?.className || "";
    const language = /language-(\w+)/.exec(className)?.[1] || "";
    return (
      <CodeBlock code={String(code).replace(/\n$/, "")} language={language} />
    );
  },
  table: ({ node, ...props }) => (
    <div className="scrollbar-thin my-3.5 overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
      <table className="w-full min-w-[520px] border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => (
    <thead className="bg-stone-50 dark:bg-stone-900" {...props} />
  ),
  th: ({ node, ...props }) => (
    <th
      className="whitespace-nowrap border-b border-stone-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:border-stone-800 dark:text-stone-400"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td
      className="border-b border-stone-100 px-3 py-2 align-top text-stone-700 last:border-b-0 dark:border-stone-800/60 dark:text-stone-300"
      {...props}
    />
  ),
};

const Markdown = ({ children }) => (
  <div className="min-w-0 text-[14px] text-stone-700 dark:text-stone-300 sm:text-[14.5px]">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Link preview
// ─────────────────────────────────────────────────────────────
const LinkPreview = ({ attachment }) => {
  const url = attachment.url || "";
  const domain = useMemo(() => getDomain(url), [url]);
  const favicon = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : "";
  const title =
    attachment.name && attachment.name.trim() ? attachment.name : domain || url;

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-2 rounded-xl border border-stone-200/80 bg-white px-2.5 py-2 transition-all duration-150 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-sm dark:border-stone-800 dark:bg-stone-900 dark:hover:border-teal-500/40 sm:gap-2.5 sm:px-3 sm:py-2.5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200/60 dark:bg-stone-800 dark:ring-stone-700/60 sm:h-9 sm:w-9">
        {favicon ? (
          <img
            src={favicon}
            alt=""
            className="h-3.5 w-3.5 sm:h-4 sm:w-4"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500 sm:h-4 sm:w-4"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L12 5" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07L12 19" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-stone-800 dark:text-stone-100 sm:text-[12.5px]">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-stone-400 dark:text-stone-500 sm:text-[11px]">
          {domain || url}
        </span>
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5 shrink-0 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-teal-500 dark:text-stone-600 dark:group-hover:text-teal-400"
      >
        <path
          d="M7 17L17 7M9 7h8v8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
};

// ─────────────────────────────────────────────────────────────
// Assistant image grid
// ─────────────────────────────────────────────────────────────
const AssistantImageGrid = ({ images }) => {
  if (!images || images.length === 0) return null;

  if (images.length === 1) {
    const img = images[0];
    return (
      <a
        href={img.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block w-full max-w-[220px] overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-100 shadow-sm dark:border-stone-800 dark:bg-stone-800 sm:max-w-[260px]"
      >
        <img
          src={img.url}
          alt={img.name || ""}
          loading="lazy"
          className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </a>
    );
  }

  const cols = images.length === 2 ? "grid-cols-2" : "grid-cols-3";
  const shown = images.slice(0, 6);

  return (
    <div className={`grid w-full max-w-xs ${cols} gap-1.5 sm:max-w-sm`}>
      {shown.map((img, i) => (
        <a
          key={`${img.url}-${i}`}
          href={img.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative overflow-hidden rounded-xl border border-stone-200/80 bg-stone-100 dark:border-stone-800 dark:bg-stone-800"
        >
          <img
            src={img.url}
            alt={img.name || ""}
            loading="lazy"
            className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </a>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Generated document card
// ─────────────────────────────────────────────────────────────
const DocumentCard = ({ attachment, onOpen }) => {
  const isPresentation = attachment.documentType === "presentation";
  const meta = isPresentation
    ? {
        label: "Presentation",
        bg: "bg-teal-50 dark:bg-teal-500/15",
        text: "text-teal-600 dark:text-teal-400",
      }
    : {
        label: "Document",
        bg: "bg-blue-50 dark:bg-blue-500/15",
        text: "text-blue-600 dark:text-blue-400",
      };

  return (
    <button
      type="button"
      onClick={() => onOpen(attachment.documentId)}
      className="group flex w-full items-center gap-2.5 rounded-2xl border border-stone-200/80 bg-white px-3 py-2.5 text-left shadow-sm shadow-stone-900/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_10px_24px_-16px_rgba(13,148,136,0.4)] dark:border-stone-800 dark:bg-stone-900 dark:shadow-none dark:hover:border-teal-500/40 dark:hover:shadow-[0_10px_24px_-16px_rgba(13,148,136,0.55)] sm:gap-3 sm:px-3.5 sm:py-3"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${meta.bg} ${meta.text}`}
      >
        {isPresentation ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-4 w-4 sm:h-5 sm:w-5"
          >
            <rect x="3" y="4" width="18" height="12" rx="1.5" />
            <path d="M8 20h8M12 16v4" strokeLinecap="round" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-4 w-4 sm:h-5 sm:w-5"
          >
            <path
              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
              strokeLinecap="round"
            />
            <path d="M14 2v6h6" strokeLinecap="round" />
            <path d="M8 13h8M8 17h5" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100 sm:text-[13px]">
          {attachment.title || "Generated file"}
        </span>
        <span
          className={`mt-0.5 block text-[9.5px] font-semibold uppercase tracking-wider sm:text-[10px] ${meta.text}`}
        >
          {meta.label} · {attachment.pageCount || 0}{" "}
          {isPresentation ? "slides" : "pages"} · Open
        </span>
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-4 w-4 shrink-0 text-stone-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-teal-500 dark:text-stone-600 dark:group-hover:text-teal-400"
      >
        <path
          d="M5 12h14M12 5l7 7-7 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Created form card
// ─────────────────────────────────────────────────────────────
const CreatedFormCard = ({ session, onOpen }) => {
  const draft = session?.draft || {};
  const fieldCount = (draft.fields || []).filter(
    (f) => f.type !== "section"
  ).length;
  const typeLabel = (draft.type || "form").toLowerCase();
  const visibilityLabel =
    draft.visibility === "private" ? "Invited only" : "Public";

  return (
    <button
      type="button"
      onClick={() => onOpen(session.createdFormId)}
      className="group flex w-full items-center gap-3 rounded-xl border border-stone-200/80 bg-white px-3.5 py-3 text-left transition-colors duration-150 hover:border-teal-200 hover:bg-teal-50/20 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-500 transition-colors duration-150 group-hover:bg-teal-50 group-hover:text-teal-600 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:bg-teal-500/15 dark:group-hover:text-teal-400">
        <IconForms className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          {draft.title || "Untitled form"}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-stone-500 dark:text-stone-400">
          {fieldCount} question{fieldCount === 1 ? "" : "s"}
          <span className="mx-1 text-stone-300 dark:text-stone-600">·</span>
          {visibilityLabel}
          <span className="mx-1 text-stone-300 dark:text-stone-600">·</span>
          <span className="capitalize">{typeLabel}</span>
        </span>
      </span>
      <IconArrowRight className="h-4 w-4 shrink-0 text-stone-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-teal-500 dark:text-stone-600 dark:group-hover:text-teal-400" />
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// User attachment preview
// ─────────────────────────────────────────────────────────────
const UserAttachmentPreview = ({ attachment }) => {
  if (attachment.type === "image") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900"
      >
        <img
          src={attachment.url}
          alt={attachment.name || "attachment"}
          className="max-h-48 max-w-[180px] object-cover sm:max-h-56 sm:max-w-[280px]"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 shadow-sm transition-colors hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 sm:px-3 sm:py-2 sm:text-xs"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-lg bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 sm:h-6 sm:w-6">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3 w-3 sm:h-3.5 sm:w-3.5"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            strokeLinecap="round"
          />
          <path d="M14 2v6h6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="max-w-[130px] truncate sm:max-w-[160px]">
        {attachment.name || "Document"}
      </span>
    </a>
  );
};

// ─────────────────────────────────────────────────────────────
// Thinking indicator
// ─────────────────────────────────────────────────────────────
const ThinkingBubble = ({ statuses = [] }) => {
  const tail = statuses.slice(-3);

  return (
    <div className="flex items-start gap-2.5">
      <XamutAvatar size="sm" />
      <div className="min-w-0 flex-1 pt-1">
        {tail.length === 0 ? (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400" />
            <span className="ml-1 text-[11px] text-stone-400 dark:text-stone-500 sm:text-[12px]">
              Thinking…
            </span>
          </div>
        ) : (
          <ul className="space-y-1">
            {tail.map((s, i) => {
              const isLast = i === tail.length - 1;
              return (
                <li
                  key={`${s}-${i}`}
                  className={`flex items-start gap-2 text-[11.5px] leading-snug sm:text-[12.5px] ${
                    isLast
                      ? "text-stone-800 dark:text-stone-200"
                      : "text-stone-400 dark:text-stone-500"
                  }`}
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      isLast
                        ? "bg-teal-500 dark:bg-teal-400"
                        : "bg-stone-300 dark:bg-stone-600"
                    }`}
                  />
                  <span className={isLast ? "font-medium" : ""}>{s}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Form session panel
// ─────────────────────────────────────────────────────────────
const FormSessionPanel = ({ session, onSessionUpdate, onCancel }) => {
  const [picked, setPicked] = useState([]);
  const [otherText, setOtherText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState("");

  const [answerFormAi, { isLoading: answering }] =
    useAnswerFormAiQuestionMutation();
  const [regenerateFormAi, { isLoading: regenning }] =
    useRegenerateFormAiDraftMutation();
  const [confirmFormAi, { isLoading: confirming }] =
    useConfirmFormAiSessionMutation();
  const [cancelFormAi, { isLoading: cancelling }] =
    useCancelFormAiSessionMutation();

  useEffect(() => {
    setPicked([]);
    setOtherText("");
    setFeedback("");
    setShowFeedback(false);
    setError("");
  }, [session._id, session.questionCount, session.awaitingConfirm, session.status]);

  const question = session.pendingQuestion;
  const awaitingConfirm = session.awaitingConfirm;
  const draft = session.draft;

  const toggleOption = (opt) => {
    if (!question) return;
    if (!question.multiSelect) {
      setPicked([opt.id]);
      return;
    }
    setPicked((prev) =>
      prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
    );
  };

  const handleAnswer = async () => {
    if (!question) return;
    const other = otherText.trim();
    if (!picked.length && !other) {
      setError("Pick an option or type your own.");
      return;
    }
    try {
      const res = await answerFormAi({
        sessionId: session._id,
        answer: { optionIds: picked, otherText: other || undefined },
      }).unwrap();
      onSessionUpdate?.(res.session);
    } catch (err) {
      setError(err?.data?.message || "Couldn't send that answer.");
    }
  };

  const handleRegen = async () => {
    if (!feedback.trim()) return;
    try {
      const res = await regenerateFormAi({
        sessionId: session._id,
        feedback: feedback.trim(),
      }).unwrap();
      onSessionUpdate?.(res.session);
    } catch (err) {
      setError(err?.data?.message || "Couldn't rework the draft.");
    }
  };

  const handleConfirm = async () => {
    try {
      const res = await confirmFormAi({ sessionId: session._id }).unwrap();
      onSessionUpdate?.(res.session, res.result);
    } catch (err) {
      setError(err?.data?.message || "Couldn't create the form.");
    }
  };

  const handleCancel = async () => {
    try {
      const res = await cancelFormAi({ sessionId: session._id }).unwrap();
      onSessionUpdate?.(res.session);
      onCancel?.();
    } catch (err) {
      setError(err?.data?.message || "Couldn't cancel.");
    }
  };

  const busy = answering || regenning || confirming || cancelling;

  if (question) {
    return (
      <div className="mb-2 overflow-hidden rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white to-white shadow-sm dark:border-teal-500/30 dark:from-teal-500/10 dark:via-stone-900 dark:to-stone-900">
        <div className="flex items-center justify-between gap-2 border-b border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
              <IconSparkle className="h-3 w-3" />
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-600 dark:text-teal-400">
              Building your form
            </span>
            {session.questionCount ? (
              <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-teal-500 ring-1 ring-teal-100 dark:bg-stone-800/80 dark:text-teal-400 dark:ring-teal-500/20">
                {session.questionCount}/{MAX_FORM_QUESTIONS}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-200"
            aria-label="Cancel form session"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-3 py-2.5 sm:px-3.5">
          <p className="mb-2 text-[13px] font-medium leading-snug text-stone-800 dark:text-stone-100">
            {question.text}
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {question.options.map((opt) => {
              const active = picked.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleOption(opt)}
                  disabled={busy}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all active:scale-[0.97] disabled:opacity-60 ${
                    active
                      ? "border-teal-400 bg-teal-500 text-white shadow-sm shadow-teal-500/25 dark:border-teal-400 dark:bg-teal-500"
                      : "border-stone-200 bg-white text-stone-700 hover:border-teal-300 hover:bg-teal-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {question.allowOther ? (
            <input
              type="text"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAnswer();
                }
              }}
              placeholder={question.otherPlaceholder || "Or type your own…"}
              disabled={busy}
              className="mb-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
              {question.multiSelect ? "Pick any that apply" : "Pick one"}
            </span>
            <button
              type="button"
              onClick={handleAnswer}
              disabled={busy || (!picked.length && !otherText.trim())}
              className="rounded-full bg-gradient-to-br from-teal-500 to-teal-600 px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {answering ? "Sending…" : "Next"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 sm:px-3.5">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (awaitingConfirm && draft) {
    const realFields = (draft.fields || []).filter((f) => f.type !== "section");
    const fieldCount = realFields.length;

    return (
      <div className="mb-2 overflow-hidden rounded-2xl border border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white to-white shadow-sm dark:border-teal-500/30 dark:from-teal-500/10 dark:via-stone-900 dark:to-stone-900">
        <div className="flex items-center justify-between gap-2 border-b border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
              <IconCheck className="h-3 w-3" />
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-600 dark:text-teal-400">
              Preview
            </span>
            <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-teal-500 ring-1 ring-teal-100 dark:bg-stone-800/80 dark:text-teal-400 dark:ring-teal-500/20">
              {fieldCount} question{fieldCount === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-200"
            aria-label="Cancel form session"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>

        <div
          className="scrollbar-thin overflow-y-auto px-3 py-2.5 sm:px-3.5"
          style={{ maxHeight: "min(44dvh, 280px)" }}
        >
          <div className="mb-2">
            <p className="truncate text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
              {draft.title || "Untitled form"}
            </p>
            {draft.description ? (
              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">
                {draft.description}
              </p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
                {draft.type || "form"}
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {draft.visibility === "private" ? "Invited only" : "Public"}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            {realFields.length === 0 ? (
              <p className="py-2 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                No questions yet. Ask for a change below.
              </p>
            ) : (
              realFields.map((f, i) => (
                <div
                  key={f.id || i}
                  className="rounded-xl border border-stone-200/80 bg-white px-2.5 py-2 dark:border-stone-700 dark:bg-stone-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 break-words text-[12.5px] font-medium leading-snug text-stone-800 dark:text-stone-100">
                      <span className="mr-1.5 text-stone-400 dark:text-stone-500">
                        {i + 1}.
                      </span>
                      {f.label || `Question ${i + 1}`}
                      {f.required ? (
                        <span className="ml-1 text-teal-500 dark:text-teal-400">
                          *
                        </span>
                      ) : null}
                    </p>
                    <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-500 dark:bg-stone-700/60 dark:text-stone-400">
                      {FIELD_LABEL[f.type] || f.type}
                    </span>
                  </div>

                  {f.options?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {f.options.slice(0, 8).map((o) => (
                        <span
                          key={o.id}
                          className="rounded-md border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                        >
                          {o.label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {f.scoring?.points ? (
                    <p className="mt-1 text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                      {f.scoring.points} pt
                      {f.scoring.points === 1 ? "" : "s"}
                      {f.scoring.correct?.length
                        ? ` · correct: ${f.scoring.correct.join(", ")}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {showFeedback ? (
          <div className="border-t border-teal-100/80 px-3 py-2.5 dark:border-teal-500/20 sm:px-3.5">
            <textarea
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should change? e.g. 'add a phone field' or 'make it 10 questions'"
              autoFocus
              disabled={busy}
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFeedback(false);
                  setFeedback("");
                }}
                disabled={busy}
                className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRegen}
                disabled={busy || !feedback.trim()}
                className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-stone-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-300"
              >
                {regenning ? "Reworking…" : "Apply change"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 border-t border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              disabled={busy}
              className="rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Change
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || realFields.length === 0}
              className="rounded-full bg-gradient-to-br from-teal-500 to-teal-600 px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {confirming ? "Creating…" : "Looks good, create"}
            </button>
          </div>
        )}

        {error ? (
          <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 sm:px-3.5">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
};

// ─────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────
const MessageBubble = ({ message, userInfo }) => {
  const navigate = useNavigate();
  const isUser = message.role === "user";
  const attachments = message.attachments || [];
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {attachments.map((a, i) => (
              <UserAttachmentPreview key={i} attachment={a} />
            ))}
          </div>
        )}

        {message.content ? (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-teal-600 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white sm:max-w-[70%] sm:text-[14.5px] dark:bg-teal-600">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : null}

        {message.createdAt ? (
          <span className="pr-1 text-[10px] text-stone-400 dark:text-stone-500">
            {formatTime(message.createdAt)}
          </span>
        ) : null}
      </div>
    );
  }

  const generatedDocs = attachments.filter(
    (a) => a.type === "generated-document"
  );
  const images = attachments.filter((a) => a.type === "image");
  const links = attachments.filter((a) => a.type === "link");
  const createdForms = attachments.filter(
    (a) =>
      a.type === "form-session" &&
      a.sessionSnapshot?.status === "done" &&
      a.sessionSnapshot?.createdFormId
  );

  const cleanedContent = preprocessContent(message.content);
  const hasImages = images.length > 0;
  const hasLinks = links.length > 0;
  const hasDocs = generatedDocs.length > 0;
  const hasCreatedForms = createdForms.length > 0;
  const hasExtras = hasImages || hasLinks || hasDocs || hasCreatedForms;

  return (
    <div className="group flex items-start gap-2.5">
      <XamutAvatar size="sm" />

      <div className="min-w-0 flex-1 pt-0.5">
        {cleanedContent ? (
          <div className="max-w-full text-stone-700 dark:text-stone-300 sm:max-w-[85%]">
            <Markdown>{cleanedContent}</Markdown>
          </div>
        ) : null}

        {hasExtras ? (
          <div className="mt-2 flex max-w-full flex-col gap-2 sm:max-w-[85%]">
            {hasCreatedForms
              ? createdForms.map((a, i) => (
                  <CreatedFormCard
                    key={`form-${i}`}
                    session={a.sessionSnapshot}
                    onOpen={(id) => navigate(`/forms/${id}/edit`)}
                  />
                ))
              : null}
            {hasImages ? <AssistantImageGrid images={images} /> : null}
            {hasLinks ? (
              <div className="flex flex-col gap-1.5">
                {links.map((a, i) => (
                  <LinkPreview key={`link-${i}`} attachment={a} />
                ))}
              </div>
            ) : null}
            {hasDocs
              ? generatedDocs.map((a, i) => (
                  <DocumentCard
                    key={`doc-${i}`}
                    attachment={a}
                    onOpen={(id) => navigate(`/documents/${id}`)}
                  />
                ))
              : null}
          </div>
        ) : null}

        {cleanedContent ? (
          <div className="mt-1.5 flex items-center gap-2">
            {message.createdAt ? (
              <span className="text-[10px] text-stone-400 dark:text-stone-500">
                {formatTime(message.createdAt)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-medium text-stone-400 opacity-100 transition-opacity duration-150 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 sm:opacity-0 sm:group-hover:opacity-100"
            >
              {copied ? (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="h-3 w-3 text-teal-500 dark:text-teal-400"
                  >
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    className="h-3 w-3"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────
const EmptyState = ({ userInfo, onSuggestion }) => (
  <div className="mx-auto flex max-w-2xl flex-col items-center px-1 pb-6 pt-8 text-center sm:pb-10 sm:pt-16">
    <XamutOrb size={72} />

    <p className="mt-5 text-[15px] font-semibold text-teal-600 dark:text-teal-400 sm:text-base">
      Hello{userInfo?.name ? `, ${userInfo.name.split(" ")[0]}` : ""}
    </p>
    <h2 className="mt-1 text-[22px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
      How can I assist you today?
    </h2>

    <div className="mt-7 grid w-full grid-cols-1 gap-2.5 text-left sm:mt-9 sm:grid-cols-2 sm:gap-3">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.text}
          onClick={() => onSuggestion(s.text)}
          className="group flex flex-col gap-2.5 rounded-2xl border border-stone-200/80 bg-white p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-[0_10px_28px_-16px_rgba(13,148,136,0.35)] dark:border-stone-800 dark:bg-stone-900 dark:hover:border-teal-500/40 dark:hover:shadow-[0_10px_28px_-16px_rgba(13,148,136,0.55)] sm:p-4"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600 transition-colors duration-200 group-hover:bg-teal-500 group-hover:text-white dark:bg-teal-500/15 dark:text-teal-400">
            <IconSparkle className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-stone-900 dark:text-stone-100 sm:text-[13.5px]">
              {s.tag}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-stone-500 dark:text-stone-400 sm:text-[12.5px]">
              {s.desc}
            </span>
          </span>
        </button>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Chat page
// ─────────────────────────────────────────────────────────────
const Chat = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);

  const [logoutApi] = useLogoutMutation();

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [agent, setAgent] = useState("chat");
  const [forceType, setForceType] = useState(null);

  const [input, setInput] = useState("");
  const [pending, setPending] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const atBottomRef = useRef(true);

  const { data: listData, isLoading: listLoading } = useListConversationsQuery();
  const conversations = listData?.conversations || [];
  const grouped = useMemo(
    () => groupConversations(conversations),
    [conversations]
  );

  const { data: convoData } = useGetConversationQuery(conversationId, {
    skip: !conversationId,
  });

  const [deleteConversation] = useDeleteConversationMutation();
  const [uploadAttachment] = useUploadAttachmentMutation();

  const { stream: streamChat, isStreaming } = useChatStream();
  const [liveStatuses, setLiveStatuses] = useState([]);

  const isSending = isStreaming;

  const latestFormSessionId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const atts = m.attachments || [];
      const att = atts.find((a) => a.type === "form-session");
      if (!att) continue;
      return att.sessionId || att.sessionSnapshot?._id || null;
    }
    return null;
  }, [messages]);

  const { data: sessionData } = useGetFormAiSessionQuery(latestFormSessionId, {
    skip: !latestFormSessionId,
  });

  const liveFormSession = sessionData?.session || null;

  useEffect(() => {
    if (!liveFormSession) return;
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.role !== "assistant") return m;
        const atts = (m.attachments || []).map((a) => {
          if (
            a.type === "form-session" &&
            String(a.sessionId) === String(liveFormSession._id)
          ) {
            const prevSnap = a.sessionSnapshot || {};
            if (
              prevSnap.status !== liveFormSession.status ||
              prevSnap.createdFormId !== liveFormSession.createdFormId ||
              prevSnap.awaitingConfirm !== liveFormSession.awaitingConfirm ||
              prevSnap.questionCount !== liveFormSession.questionCount
            ) {
              changed = true;
              return { ...a, sessionSnapshot: liveFormSession };
            }
          }
          return a;
        });
        if (!changed) return m;
        return { ...m, attachments: atts };
      });
      return changed ? next : prev;
    });
  }, [liveFormSession]);

  const showFormPanel =
    !!liveFormSession &&
    liveFormSession.status !== "done" &&
    liveFormSession.status !== "cancelled";

  const handleFormSessionUpdate = (updatedSession) => {
    if (!updatedSession) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.role !== "assistant") return m;
        let touched = false;
        const atts = (m.attachments || []).map((a) => {
          if (
            a.type === "form-session" &&
            String(a.sessionId) === String(updatedSession._id)
          ) {
            touched = true;
            return { ...a, sessionSnapshot: updatedSession };
          }
          return a;
        });
        return touched ? { ...m, attachments: atts } : m;
      })
    );
  };

  const scrollToBottom = (behavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  useEffect(() => {
    if (convoData?.conversation) {
      setMessages(convoData.conversation.messages || []);
      setAgent(convoData.conversation.agent || "chat");
      atBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [convoData]);

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, isSending, liveStatuses]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    atBottomRef.current = near;
    setShowJump(!near);
  };

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setPending([]);
    setInput("");
    setAgent("chat");
    setForceType(null);
    setLiveStatuses([]);
    setSidebarOpen(false);
    atBottomRef.current = true;
  };

  const handleSelectConversation = (id) => {
    if (id === conversationId) {
      setSidebarOpen(false);
      return;
    }
    setConversationId(id);
    setMessages([]);
    setPending([]);
    setForceType(null);
    setLiveStatuses([]);
    setSidebarOpen(false);
    atBottomRef.current = true;
  };

  const handleDeleteConversation = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteConversation(id).unwrap();
      if (id === conversationId) handleNewChat();
    } catch {
      /* ignore */
    }
  };

  const handleFilePick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadAttachment(fd).unwrap();
      setPending((p) => [...p, res.attachment]);
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePending = (index) => {
    setPending((p) => p.filter((_, i) => i !== index));
  };

  const [regenerateFormAi] = useRegenerateFormAiDraftMutation();

  const handleSend = async () => {
    const text = input.trim();
    if (!text && pending.length === 0) return;
    if (isSending || uploading) return;

    const looksLikeFormLookup = FORM_LOOKUP_RE.test(text);

    if (
      showFormPanel &&
      liveFormSession &&
      text &&
      pending.length === 0 &&
      !looksLikeFormLookup
    ) {
      const optimistic = {
        _id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        attachments: [],
        createdAt: new Date().toISOString(),
      };
      atBottomRef.current = true;
      setMessages((m) => [...m, optimistic]);
      setInput("");
      try {
        const res = await regenerateFormAi({
          sessionId: liveFormSession._id,
          feedback: text,
        }).unwrap();
        handleFormSessionUpdate(res.session);
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            _id: `err-${Date.now()}`,
            role: "assistant",
            content: `⚠️ Couldn't send that. ${
              err?.data?.message || err?.message || "Try again."
            }`,
          },
        ]);
      }
      return;
    }

    const optimistic = {
      _id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      attachments: pending,
      createdAt: new Date().toISOString(),
    };
    const attachmentsToSend = pending;

    atBottomRef.current = true;
    setMessages((m) => [...m, optimistic]);
    setInput("");
    setPending([]);
    setLiveStatuses([]);

    await streamChat(
      {
        conversationId: conversationId || undefined,
        message: text,
        agent,
        attachments: attachmentsToSend,
        forceType: forceType || undefined,
      },
      {
        onStatus: (s) => setLiveStatuses((prev) => [...prev, s]),
        onDone: (evt) => {
          if (!conversationId && evt.conversationId) {
            setConversationId(evt.conversationId);
          }
          setMessages((m) => [...m, evt.reply]);
          setLiveStatuses([]);

          const tags = ["ConversationList"];
          const atts = evt.reply?.attachments || [];
          if (atts.some((a) => a.type === "generated-document")) {
            tags.push("DocumentList");
          }
          if (atts.some((a) => a.type === "form-session")) {
            tags.push("FormList");
          }
          dispatch(aiApiSlice.util.invalidateTags(tags));
        },
        onError: (err) => {
          const detail = err?.message || "Unknown error";
          setMessages((m) => [
            ...m,
            {
              _id: `err-${Date.now()}`,
              role: "assistant",
              content: `⚠️ **Something went wrong.**\n\n\`\`\`\n${detail}\n\`\`\``,
            },
          ]);
          setLiveStatuses([]);
        },
      }
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleLogout = async () => {
    try {
      await logoutApi().unwrap();
    } catch {
      /* ignore */
    }
    dispatch(logoutAction());
    navigate("/", { replace: true });
  };

  const handleSuggestion = (s) => {
    setInput(s);
    textareaRef.current?.focus();
  };

  const activeAgent = useMemo(
    () => AGENTS.find((a) => a.id === agent) || AGENTS[0],
    [agent]
  );

  const isEmpty = messages.length === 0;
  const activeTitle = conversationId
    ? conversations.find((c) => c._id === conversationId)?.title ||
      "Conversation"
    : "New chat";

  const showForcePill = input.trim().length > 0 && !showFormPanel;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-stone-900/40 backdrop-blur-[3px] transition-opacity md:hidden dark:bg-black/60"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-stone-200/70 bg-white transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] dark:border-stone-800/70 dark:bg-stone-950 md:relative md:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0 shadow-2xl shadow-stone-900/20 dark:shadow-black/60"
            : "-translate-x-full"
        }`}
      >
        <div
          className="flex items-center justify-between px-4 pb-3 pt-4"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <Link to="/" className="flex items-center gap-2">
            <XamutMark className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Xamut
            </span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 md:hidden"
            aria-label="Close menu"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={handleNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-3 py-2.5 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-stone-800 active:scale-[0.985] dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              className="h-4 w-4"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        </div>

        <div className="px-3 pb-2">
          <Link
            to="/forms"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-stone-600 transition-colors duration-150 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <IconForms className="h-4 w-4 text-stone-400 dark:text-stone-500" />
            My forms
          </Link>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4 pt-1">
          {listLoading ? (
            <div className="space-y-1.5 px-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-9 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800/60"
                />
              ))}
            </div>
          ) : null}

          {!listLoading && conversations.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[12px] leading-relaxed text-stone-400 dark:text-stone-500">
                No conversations yet.
                <br />
                Start a new chat to get going.
              </p>
            </div>
          ) : null}

          {!listLoading
            ? grouped.map((group) => (
                <div key={group.label} className="mb-3 last:mb-0">
                  <p className="px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map((c) => {
                      const isActive = c._id === conversationId;
                      return (
                        <div
                          key={c._id}
                          onClick={() => handleSelectConversation(c._id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              handleSelectConversation(c._id);
                          }}
                          className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150 ${
                            isActive
                              ? "bg-teal-50/80 dark:bg-teal-500/10"
                              : "hover:bg-stone-100/70 dark:hover:bg-stone-800/50"
                          }`}
                        >
                          {isActive ? (
                            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-teal-500 dark:bg-teal-400" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-[13px] font-medium ${
                                isActive
                                  ? "text-teal-900 dark:text-teal-200"
                                  : "text-stone-700 dark:text-stone-300"
                              }`}
                            >
                              {c.title || "New chat"}
                            </p>
                          </div>
                          <button
                            onClick={(e) => handleDeleteConversation(c._id, e)}
                            className="shrink-0 rounded-md p-1 text-stone-300 opacity-0 transition-all duration-150 hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                            aria-label="Delete conversation"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="h-3.5 w-3.5"
                            >
                              <path
                                d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            : null}
        </nav>

        {/* ── Theme toggle ────────────────────────────────── */}
        <div className="px-2 pb-2">
          <ThemeToggle />
        </div>

        <div className="mx-2 mb-2 flex items-center gap-2.5 rounded-xl border border-stone-200/70 bg-stone-50/70 p-2.5 dark:border-stone-800/70 dark:bg-stone-900/50">
          <UserAvatar userInfo={userInfo} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
              {userInfo?.name || "User"}
            </p>
            <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
              {userInfo?.email || ""}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white hover:text-red-500 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-red-400"
            aria-label="Log out"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-stone-950">
        <header
          className="z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-stone-200/70 bg-white/85 px-2 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/85 sm:h-16 sm:gap-3 sm:px-4 md:px-6"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-600 transition-all hover:bg-stone-100 hover:text-stone-900 active:scale-95 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 sm:h-9 sm:w-9 sm:rounded-xl md:hidden"
            aria-label="Open menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
            </svg>
          </button>

          <XamutAvatar size="sm" />

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[12.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:text-sm">
              {activeTitle}
            </h1>
            <p className="truncate text-[10px] text-stone-400 dark:text-stone-500 sm:text-[11px]">
              {activeAgent.hint}
            </p>
          </div>

          <AgentPickerMobile agent={agent} onChange={setAgent} />

          <AgentSwitch
            agent={agent}
            onChange={setAgent}
            className="hidden w-[260px] sm:grid"
          />

          <button
            onClick={handleNewChat}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-all hover:bg-stone-100 hover:text-teal-600 active:scale-95 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-teal-400 sm:flex"
            aria-label="New chat"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className="h-4 w-4"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="scrollbar-thin h-full overflow-y-auto scroll-smooth"
          >
            <div className="mx-auto w-full max-w-3xl px-2.5 pb-6 pt-3 sm:px-6 sm:pt-8">
              {isEmpty && !isSending ? (
                <EmptyState
                  userInfo={userInfo}
                  onSuggestion={handleSuggestion}
                />
              ) : null}

              <div className="space-y-4 sm:space-y-6">
                {messages.map((m) => (
                  <MessageBubble key={m._id} message={m} userInfo={userInfo} />
                ))}
                {isSending ? <ThinkingBubble statuses={liveStatuses} /> : null}
              </div>
            </div>
          </div>

          {showJump ? (
            <button
              onClick={() => {
                atBottomRef.current = true;
                scrollToBottom();
              }}
              className="absolute bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white text-stone-500 shadow-lg shadow-stone-900/5 transition-all hover:-translate-y-0.5 hover:text-teal-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:shadow-black/40 dark:hover:text-teal-400 sm:h-9 sm:w-9"
              aria-label="Scroll to latest"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-3.5 w-3.5 sm:h-4 sm:w-4"
              >
                <path
                  d="M12 5v14M19 12l-7 7-7-7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : null}
        </div>

        {/* ── Composer ───────────────────────────────────────── */}
        <div
          className="shrink-0 bg-gradient-to-t from-white via-white to-transparent px-2 pt-1.5 dark:from-stone-950 dark:via-stone-950 sm:px-6 sm:pt-2"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)",
          }}
        >
          <div className="mx-auto max-w-3xl">
            {showFormPanel && liveFormSession ? (
              <FormSessionPanel
                session={liveFormSession}
                onSessionUpdate={handleFormSessionUpdate}
              />
            ) : null}

            <div className="rounded-[26px] border border-stone-200/90 bg-white p-2 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_36px_-20px_rgba(28,25,23,0.28)] transition-all duration-200 focus-within:border-teal-300/80 focus-within:shadow-[0_1px_2px_rgba(28,25,23,0.04),0_18px_40px_-18px_rgba(13,148,136,0.35)] dark:border-stone-800 dark:bg-stone-900 dark:shadow-[0_16px_36px_-20px_rgba(0,0,0,0.6)] dark:focus-within:border-teal-500/50 sm:p-2.5">
              {pending.length > 0 || uploading ? (
                <div className="flex flex-wrap gap-1.5 px-1.5 pb-1.5 pt-0.5 sm:gap-2 sm:px-2">
                  {pending.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded-lg border border-stone-200/80 bg-stone-50 py-0.5 pl-1 pr-0.5 text-[10.5px] dark:border-stone-700 dark:bg-stone-800 sm:gap-2 sm:rounded-xl sm:py-1.5 sm:pl-2 sm:pr-1 sm:text-xs"
                    >
                      {a.type === "image" ? (
                        <img
                          src={a.url}
                          alt={a.name}
                          className="h-5 w-5 rounded object-cover sm:h-6 sm:w-6 sm:rounded-lg"
                        />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400 sm:h-6 sm:w-6 sm:rounded-lg">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                          >
                            <path
                              d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              strokeLinecap="round"
                            />
                            <path d="M14 2v6h6" strokeLinecap="round" />
                          </svg>
                        </span>
                      )}
                      <span className="max-w-[100px] truncate text-stone-600 dark:text-stone-300 sm:max-w-[150px]">
                        {a.name}
                      </span>
                      <button
                        onClick={() => handleRemovePending(i)}
                        className="rounded p-0.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-100"
                        aria-label="Remove attachment"
                      >
                        <IconClose className="h-3 w-3" />
                      </button>
                    </div>
                  ))}

                  {uploading ? (
                    <div className="flex items-center gap-2 rounded-lg border border-stone-200/80 bg-stone-50 px-2 py-1 text-[10.5px] text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-600 dark:border-t-teal-400 sm:h-3.5 sm:w-3.5" />
                      Uploading…
                    </div>
                  ) : null}
                </div>
              ) : null}

              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  showFormPanel
                    ? "Type a change, or tap an option above…"
                    : "Ask me anything…"
                }
                className="max-h-[140px] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500 sm:max-h-[200px] sm:px-3 sm:py-2.5"
              />

              <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-0.5 sm:px-1.5">
                <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={handleFilePick}
                    disabled={uploading}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-teal-600 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-teal-400"
                    aria-label="Attach file"
                  >
                    <IconPaperclip className="h-[18px] w-[18px]" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileChange}
                    accept="image/*,.pdf,.docx,.txt"
                    className="hidden"
                  />

                  {showForcePill ? (
                    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-200/80 bg-stone-50 p-0.5 dark:border-stone-700 dark:bg-stone-800">
                      {[
                        { id: null, label: "Auto" },
                        { id: "document", label: "Doc" },
                        { id: "presentation", label: "Slides" },
                      ].map((opt) => {
                        const active = forceType === opt.id;
                        return (
                          <button
                            key={String(opt.id)}
                            type="button"
                            onClick={() => setForceType(opt.id)}
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold leading-none transition-colors ${
                              active
                                ? "bg-teal-600 text-white dark:bg-teal-500"
                                : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={
                    isSending || uploading || (!input.trim() && !pending.length)
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-md shadow-teal-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-teal-500/35 active:scale-95 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none dark:disabled:bg-stone-800 dark:disabled:text-stone-600"
                  style={
                    isSending || uploading || (!input.trim() && !pending.length)
                      ? undefined
                      : {
                          background:
                            "radial-gradient(circle at 32% 28%, #5eead4 0%, #14b8a6 55%, #0f766e 100%)",
                        }
                  }
                  aria-label="Send message"
                >
                  {isSending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <IconSend className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <p className="mt-1.5 mb-0 text-center text-[9.5px] text-stone-400 dark:text-stone-500 sm:mt-2.5 sm:text-[11px]">
              Xamut can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;