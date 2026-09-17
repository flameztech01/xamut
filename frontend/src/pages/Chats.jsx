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
import { useChatStream } from "../features/useChatStream";
import { useLogoutMutation } from "../features/userApiSlice";
import { logout as logoutAction } from "../features/auth/authSlice";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const AGENTS = [
  { id: "chat", label: "Chat", hint: "General help" },
  { id: "coding", label: "Code", hint: "Write & debug code" },
  { id: "writer", label: "Scholar", hint: "Writing & essays" },
  { id: "research", label: "Research", hint: "Deep web research" },
];

const SUGGESTIONS = [
  { tag: "Explain", text: "Explain photosynthesis like I'm 10" },
  { tag: "Chapter", text: "Write chapter 1 of my project on renewable energy" },
  { tag: "Slides", text: "Make me a 10-slide presentation on renewable energy" },
  { tag: "Ideas", text: "Give me 5 startup ideas in the AI space" },
];

const DAY = 86_400_000;

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
    className={`${className} flex shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 shadow-sm shadow-orange-500/30`}
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
  const dims = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 shadow-sm shadow-orange-500/25 ring-2 ring-white`}
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

const UserAvatar = ({ userInfo, size = "md" }) => {
  const dims = size === "sm" ? "h-8 w-8 text-[11px]" : "h-9 w-9 text-xs";
  const initial = (userInfo?.name || "U").charAt(0).toUpperCase();
  const photo = userInfo?.profilePhoto || userInfo?.profile;

  if (photo) {
    return (
      <img
        src={photo}
        alt={userInfo?.name || "You"}
        className={`${dims} shrink-0 rounded-full object-cover ring-2 ring-white`}
      />
    );
  }
  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-stone-900 font-semibold text-white`}
    >
      {initial}
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
      className={`relative grid grid-cols-4 rounded-full bg-stone-100/80 p-1 ${className}`}
    >
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-full bg-white shadow-sm ring-1 ring-stone-900/5 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
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
              ? "text-orange-600"
              : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {a.label}
        </button>
      ))}
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
    <div className="my-3 overflow-hidden rounded-xl border border-stone-800/80 bg-stone-950">
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
                className="h-3 w-3 text-orange-400"
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
      <pre className="overflow-x-auto px-3.5 py-3 text-[12px] leading-relaxed text-stone-100 sm:px-4 sm:text-[12.5px]">
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
      className="mb-2 mt-5 text-[17px] font-semibold tracking-tight text-stone-900 first:mt-0 sm:text-[18px]"
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      className="mb-2 mt-5 text-[16px] font-semibold tracking-tight text-stone-900 first:mt-0 sm:text-[17px]"
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      className="mb-1.5 mt-4 text-[14.5px] font-semibold text-stone-900 first:mt-0"
      {...props}
    />
  ),
  h4: ({ node, ...props }) => (
    <h4
      className="mb-1.5 mt-3 text-sm font-semibold text-stone-900 first:mt-0"
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
    <li className="break-words leading-[1.7] marker:text-stone-300" {...props} />
  ),
  a: ({ node, href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words font-medium text-orange-600 underline decoration-orange-300 decoration-1 underline-offset-2 transition-colors hover:text-orange-700 hover:decoration-orange-500"
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ node, ...props }) => (
    <strong className="font-semibold text-stone-900" {...props} />
  ),
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-3.5 rounded-r-lg border-l-2 border-orange-400 bg-orange-50/50 py-2 pl-4 pr-3 text-stone-600"
      {...props}
    />
  ),
  hr: () => <hr className="my-5 border-stone-200/80" />,
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
        className="break-words rounded-md border border-stone-200/70 bg-stone-100/80 px-1.5 py-0.5 font-mono text-[0.85em] text-orange-700"
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
    <div className="my-3.5 overflow-x-auto rounded-xl border border-stone-200">
      <table className="w-full min-w-[520px] border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-stone-50" {...props} />,
  th: ({ node, ...props }) => (
    <th
      className="whitespace-nowrap border-b border-stone-200 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-500"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td
      className="border-b border-stone-100 px-3 py-2 align-top text-stone-700 last:border-b-0"
      {...props}
    />
  ),
};

const Markdown = ({ children }) => (
  <div className="min-w-0 text-[14px] text-stone-700 sm:text-[14.5px]">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Link preview card (assistant sources)
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
      className="group flex items-center gap-2.5 rounded-xl border border-stone-200/80 bg-white px-3 py-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-sm"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stone-100 ring-1 ring-stone-200/60">
        {favicon ? (
          <img
            src={favicon}
            alt=""
            className="h-4 w-4"
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
            className="h-4 w-4 text-stone-400"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L12 5" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07L12 19" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-stone-800">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-stone-400">
          {domain || url}
        </span>
      </span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5 shrink-0 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-orange-500"
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
        className="group block w-full max-w-[260px] overflow-hidden rounded-2xl border border-stone-200/80 bg-stone-100 shadow-sm"
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
    <div className={`grid w-full max-w-sm ${cols} gap-1.5`}>
      {shown.map((img, i) => (
        <a
          key={`${img.url}-${i}`}
          href={img.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative overflow-hidden rounded-xl border border-stone-200/80 bg-stone-100"
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
    ? { label: "Presentation", bg: "bg-orange-50", text: "text-orange-600" }
    : { label: "Document", bg: "bg-blue-50", text: "text-blue-600" };

  return (
    <button
      type="button"
      onClick={() => onOpen(attachment.documentId)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white px-3.5 py-3 text-left shadow-sm shadow-stone-900/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_10px_24px_-16px_rgba(234,88,12,0.4)]"
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.bg} ${meta.text}`}
      >
        {isPresentation ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-5 w-5"
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
            className="h-5 w-5"
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
        <span className="block truncate text-[13px] font-semibold text-stone-800">
          {attachment.title || "Generated file"}
        </span>
        <span
          className={`mt-0.5 block text-[10px] font-semibold uppercase tracking-wider ${meta.text}`}
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
        className="h-4 w-4 shrink-0 text-stone-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-orange-500"
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
// User attachment preview
// ─────────────────────────────────────────────────────────────
const UserAttachmentPreview = ({ attachment }) => {
  if (attachment.type === "image") {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-sm"
      >
        <img
          src={attachment.url}
          alt={attachment.name || "attachment"}
          className="max-h-56 max-w-[220px] object-cover sm:max-w-[280px]"
        />
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-2xl border border-stone-200/80 bg-white px-3 py-2 text-xs text-stone-600 shadow-sm transition-colors hover:bg-stone-50"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            strokeLinecap="round"
          />
          <path d="M14 2v6h6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="max-w-[160px] truncate">
        {attachment.name || "Document"}
      </span>
    </a>
  );
};

// ─────────────────────────────────────────────────────────────
// Thinking bubble
// ─────────────────────────────────────────────────────────────
const ThinkingBubble = ({ statuses = [] }) => {
  const tail = statuses.slice(-3);

  return (
    <div className="flex items-end gap-0 sm:gap-2.5">
      <div className="hidden sm:block">
        <XamutAvatar size="sm" />
      </div>
      <div className="min-w-0 max-w-full rounded-2xl rounded-bl-md border border-stone-200/70 bg-white px-3.5 py-2.5 shadow-sm shadow-stone-900/[0.02] sm:max-w-md sm:rounded-bl-md">
        {tail.length === 0 ? (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-orange-400" />
            <span className="ml-1 text-[12px] text-stone-400">Thinking…</span>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {tail.map((s, i) => {
              const isLast = i === tail.length - 1;
              return (
                <li
                  key={`${s}-${i}`}
                  className={`flex items-start gap-2 text-[12.5px] leading-snug ${
                    isLast ? "text-stone-800" : "text-stone-400"
                  }`}
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      isLast ? "bg-orange-500" : "bg-stone-300"
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
// Message bubble (DM style)
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

  // ─── User message ─────────────────────────────────────────
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
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-orange-500 to-orange-600 px-3.5 py-2.5 text-[14px] leading-relaxed text-white shadow-sm shadow-orange-500/20 sm:max-w-[70%] sm:text-[14.5px]">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : null}

        {message.createdAt ? (
          <span className="pr-1 text-[10px] text-stone-400">
            {formatTime(message.createdAt)}
          </span>
        ) : null}
      </div>
    );
  }

  // ─── Assistant message ────────────────────────────────────
  const generatedDocs = attachments.filter(
    (a) => a.type === "generated-document"
  );
  const images = attachments.filter((a) => a.type === "image");
  const links = attachments.filter((a) => a.type === "link");

  const cleanedContent = preprocessContent(message.content);
  const hasImages = images.length > 0;
  const hasLinks = links.length > 0;
  const hasDocs = generatedDocs.length > 0;
  const hasExtras = hasImages || hasLinks || hasDocs;

  return (
    <div className="group flex items-end gap-0 sm:gap-2.5">
      <div className="hidden sm:block">
        <XamutAvatar size="sm" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 px-1">
          <span className="text-[11.5px] font-semibold text-stone-700">
            Xamut
          </span>
          {message.createdAt ? (
            <span className="text-[10px] text-stone-400">
              {formatTime(message.createdAt)}
            </span>
          ) : null}
        </div>

        {cleanedContent ? (
          <div className="max-w-full rounded-2xl rounded-bl-md border border-stone-200/70 bg-white px-3.5 py-2.5 text-stone-700 shadow-sm shadow-stone-900/[0.02] sm:max-w-[80%]">
            <Markdown>{cleanedContent}</Markdown>
          </div>
        ) : null}

        {hasExtras ? (
          <div className="mt-2 flex max-w-full flex-col gap-2 sm:max-w-[80%]">
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
          <div className="mt-1.5 flex items-center gap-1 px-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            >
              {copied ? (
                <>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="h-3 w-3 text-orange-500"
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
  <div className="flex flex-col items-center px-1 pb-8 pt-6 text-center sm:pb-10 sm:pt-8">
    <XamutMark className="h-12 w-12 rounded-2xl sm:h-14 sm:w-14" />

    <h2 className="mt-5 text-[22px] font-semibold tracking-tight text-stone-900 sm:mt-6 sm:text-[26px]">
      Hi{userInfo?.name ? `, ${userInfo.name.split(" ")[0]}` : ""} 👋
    </h2>
    <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-stone-500 sm:text-[14px]">
      Ask anything, drop a file, or pick a starting point below.
    </p>

    <div className="mt-7 w-full max-w-md space-y-2 sm:mt-9">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.text}
          onClick={() => onSuggestion(s.text)}
          className="group flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_10px_28px_-16px_rgba(234,88,12,0.35)] sm:p-3.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[10px] font-bold uppercase tracking-wide text-orange-500 transition-colors duration-200 group-hover:bg-orange-500 group-hover:text-white">
            {s.tag.slice(0, 2)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400 transition-colors group-hover:text-orange-500">
              {s.tag}
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-stone-700 sm:text-[13px]">
              {s.text}
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4 shrink-0 text-stone-300 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-orange-500"
          >
            <path
              d="M5 12h14M12 5l7 7-7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text && pending.length === 0) return;
    if (isSending || uploading) return;

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

  const showForcePill = input.trim().length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f7f5f0] text-stone-900 antialiased">
      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-stone-900/40 backdrop-blur-[3px] transition-opacity md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      {/* ─── Sidebar ─────────────────────────────────────── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-stone-200/70 bg-white transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:relative md:w-[276px] md:translate-x-0 ${
          sidebarOpen
            ? "translate-x-0 shadow-2xl shadow-stone-900/20"
            : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Link to="/" className="flex items-center gap-2.5">
            <XamutMark className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight text-stone-900">
              Xamut
            </span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 md:hidden"
            aria-label="Close menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className="h-4 w-4"
            >
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-2xl border border-stone-200/70 bg-stone-50/70 p-2.5">
          <UserAvatar userInfo={userInfo} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-stone-800">
              {userInfo?.name || "User"}
            </p>
            <p className="truncate text-[11px] text-stone-400">
              {userInfo?.email || ""}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-white hover:text-red-500"
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

        <div className="px-3 pb-3">
          <button
            onClick={handleNewChat}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-3 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-orange-500/25 transition-all duration-200 hover:shadow-md hover:shadow-orange-500/35 active:scale-[0.985]"
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

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {listLoading ? (
            <div className="space-y-1.5 px-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-xl bg-stone-100"
                />
              ))}
            </div>
          ) : null}

          {!listLoading && conversations.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[12px] leading-relaxed text-stone-400">
                No conversations yet.
                <br />
                Start a new chat to get going.
              </p>
            </div>
          ) : null}

          {!listLoading
            ? grouped.map((group) => (
                <div key={group.label} className="mb-3 last:mb-0">
                  <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
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
                          className={`group relative flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 transition-colors duration-150 ${
                            isActive
                              ? "bg-orange-50/80"
                              : "hover:bg-stone-100/70"
                          }`}
                        >
                          {isActive ? (
                            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-orange-500" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-[13px] font-medium ${
                                isActive ? "text-orange-900" : "text-stone-700"
                              }`}
                            >
                              {c.title || "New chat"}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-stone-400">
                              {c.preview || "No messages yet"}
                            </p>
                          </div>
                          <button
                            onClick={(e) => handleDeleteConversation(c._id, e)}
                            className="shrink-0 rounded-md p-1 text-stone-300 opacity-0 transition-all duration-150 hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
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
      </aside>

      {/* ─── Main ────────────────────────────────────────── */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 bg-white/85 px-2.5 backdrop-blur-xl sm:h-16 sm:gap-3 sm:px-4 md:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-600 transition-all hover:bg-stone-100 hover:text-stone-900 active:scale-95 md:hidden"
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
            <h1 className="truncate text-[13px] font-semibold tracking-tight text-stone-900 sm:text-sm">
              {activeTitle}
            </h1>
            <p className="truncate text-[10.5px] text-stone-400 sm:text-[11px]">
              {activeAgent.label} · {activeAgent.hint}
            </p>
          </div>

          <AgentSwitch
            agent={agent}
            onChange={setAgent}
            className="hidden w-[280px] sm:grid"
          />

          <button
            onClick={handleNewChat}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-all hover:bg-stone-100 hover:text-orange-600 active:scale-95 sm:flex"
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

        <div className="flex gap-1.5 overflow-x-auto border-b border-stone-200/70 bg-white/70 px-2.5 py-2 backdrop-blur-xl sm:hidden">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgent(a.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                agent === a.id
                  ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25"
                  : "bg-stone-100 text-stone-500 hover:bg-stone-200"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto scroll-smooth"
          >
            <div className="mx-auto w-full max-w-3xl px-2.5 pb-6 pt-5 sm:px-6 sm:pt-8">
              {isEmpty && !isSending ? (
                <EmptyState
                  userInfo={userInfo}
                  onSuggestion={handleSuggestion}
                />
              ) : null}

              <div className="space-y-4 sm:space-y-5">
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
              className="absolute bottom-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white text-stone-500 shadow-lg shadow-stone-900/5 transition-all hover:-translate-y-0.5 hover:text-orange-600"
              aria-label="Scroll to latest"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
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

        <div className="shrink-0 bg-gradient-to-t from-[#f7f5f0] via-[#f7f5f0] to-transparent px-2.5 pb-2.5 pt-2 sm:px-6 sm:pb-4">
          <div className="mx-auto max-w-3xl">
            {showForcePill ? (
              <div className="mb-2 flex items-center justify-end gap-1.5 overflow-x-auto pb-0.5">
                <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-stone-400 sm:inline">
                  Output
                </span>
                <div className="flex items-center gap-0.5 rounded-full border border-stone-200/80 bg-white p-0.5">
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
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                          active
                            ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25"
                            : "text-stone-500 hover:text-stone-800"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="rounded-[22px] border border-stone-200/90 bg-white p-1.5 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_12px_28px_-18px_rgba(28,25,23,0.28)] transition-all duration-200 focus-within:border-orange-300/80 focus-within:shadow-[0_1px_2px_rgba(28,25,23,0.04),0_14px_34px_-16px_rgba(234,88,12,0.35)] sm:rounded-[24px]">
              {pending.length > 0 || uploading ? (
                <div className="flex flex-wrap gap-1.5 px-1.5 pb-1.5 pt-2 sm:gap-2 sm:px-2">
                  {pending.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-stone-50 py-1 pl-1.5 pr-0.5 text-[11px] sm:gap-2 sm:py-1.5 sm:pl-2 sm:pr-1 sm:text-xs"
                    >
                      {a.type === "image" ? (
                        <img
                          src={a.url}
                          alt={a.name}
                          className="h-5 w-5 rounded-md object-cover sm:h-6 sm:w-6 sm:rounded-lg"
                        />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-orange-100 text-orange-600 sm:h-6 sm:w-6 sm:rounded-lg">
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
                      <span className="max-w-[110px] truncate text-stone-600 sm:max-w-[150px]">
                        {a.name}
                      </span>
                      <button
                        onClick={() => handleRemovePending(i)}
                        className="rounded-md p-0.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700"
                        aria-label="Remove attachment"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className="h-3 w-3"
                        >
                          <path
                            d="M18 6L6 18M6 6l12 12"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {uploading ? (
                    <div className="flex items-center gap-2 rounded-xl border border-stone-200/80 bg-stone-50 px-2.5 py-1.5 text-[11px] text-stone-500 sm:px-3 sm:py-2 sm:text-xs">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500 sm:h-3.5 sm:w-3.5" />
                      Uploading…
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex items-end gap-0.5 sm:gap-1">
                <button
                  type="button"
                  onClick={handleFilePick}
                  disabled={uploading}
                  className="shrink-0 rounded-full p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-orange-600 disabled:opacity-40 sm:p-2.5"
                  aria-label="Attach file"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    className="h-[17px] w-[17px] sm:h-[18px] sm:w-[18px]"
                  >
                    <path
                      d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*,.pdf,.docx,.txt"
                  className="hidden"
                />

                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${activeAgent.label}…`}
                  className="max-h-[160px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-relaxed text-stone-900 outline-none placeholder:text-stone-400 sm:max-h-[200px] sm:px-1.5"
                />

                <button
                  type="button"
                  onClick={handleSend}
                  disabled={
                    isSending || uploading || (!input.trim() && !pending.length)
                  }
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-md shadow-orange-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-orange-500/35 active:scale-95 disabled:bg-none disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
                  aria-label="Send message"
                >
                  {isSending ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-3.5 w-3.5"
                    >
                      <path
                        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <p className="mt-2 text-center text-[10px] text-stone-400 sm:mt-2.5 sm:text-[11px]">
              Xamut can make mistakes. Verify important info.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chat;