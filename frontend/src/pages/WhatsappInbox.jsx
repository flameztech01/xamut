// pages/WhatsAppInbox.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  useGetWhatsappConnectionQuery,
  useListWhatsappConversationsQuery,
  useListWhatsappMessagesQuery,
  useSendWhatsappMessageMutation,
} from "../features/whatsappApiSlice";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const formatTime = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDayLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / (24 * 60 * 60 * 1000));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) {
    return d.toLocaleDateString([], { weekday: "long" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: diff > 300 ? "numeric" : undefined,
  });
};

const formatRelative = (iso) => {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.floor((now - d) / 1000));
  if (sec < 60) return "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

// +2348012345678 → "+234 801 234 5678". Falls back to the raw string
// if we can't make sense of it.
const formatPhone = (phone) => {
  const s = String(phone || "").trim();
  if (!s) return "";
  const m = s.match(/^\+(\d{1,3})(\d{3})(\d{3})(\d+)$/);
  if (m) return `+${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return s;
};

const initialsFor = (name, phone) => {
  const source = (name || "").trim() || (phone || "").replace(/\D/g, "");
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (
    parts[0].charAt(0).toUpperCase() +
    parts[parts.length - 1].charAt(0).toUpperCase()
  );
};

// Deterministic tint from a phone number so avatars feel personal
// without needing real images.
const avatarTint = (seed) => {
  const s = String(seed || "");
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const tints = [
    "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  ];
  return tints[Math.abs(hash) % tints.length];
};

// Group messages into day buckets for the thread view.
const groupByDay = (messages) => {
  const groups = [];
  let current = null;
  for (const m of messages) {
    const day = new Date(m.createdAt).toDateString();
    if (!current || current.day !== day) {
      current = { day, date: m.createdAt, messages: [] };
      groups.push(current);
    }
    current.messages.push(m);
  }
  return groups;
};

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const I = {
  back: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  ),
  plus: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  send: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
    </svg>
  ),
  attach: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M21.4 11.1l-9 9a5.4 5.4 0 0 1-7.6-7.6l9.4-9.4a3.6 3.6 0 0 1 5 5l-9.4 9.4a1.8 1.8 0 0 1-2.5-2.5l8.7-8.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  close: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  check: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={c}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
    </svg>
  ),
  checkDouble: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className={c}>
      <path d="M1.5 12.5L6 17 15 8M8.5 12.5L13 17 22 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  ),
  alert: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
    </svg>
  ),
  spinner: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`animate-spin ${c}`}>
      <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
    </svg>
  ),
  whatsapp: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.4 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5-.2 0-.4 0-.6 0s-.6.1-.9.4c-.3.3-1.1 1.1-1.1 2.6 0 1.5 1.1 3 1.3 3.2.1.2 2.2 3.4 5.3 4.7.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z" />
      <path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.2-1.3c1.4.8 3.1 1.3 4.8 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3C4 15 3.5 13.5 3.5 12c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5-3.8 8.2-8.5 8.2z" />
    </svg>
  ),
  file: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
    </svg>
  ),
  external: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  empty: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={c}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Delivery tick — reads a message.status and shows the right icon
// ─────────────────────────────────────────────────────────────
const DeliveryTick = ({ status }) => {
  const base = "inline-block h-3 w-3 shrink-0";
  if (status === "failed" || status === "undelivered") {
    return <span className="text-red-400">{I.alert(base)}</span>;
  }
  if (status === "queued") {
    return <span className="text-white/60">{I.clock(base)}</span>;
  }
  if (status === "sent") {
    return <span className="text-white/70">{I.check(base)}</span>;
  }
  // delivered or read
  return <span className="text-sky-200">{I.checkDouble(base)}</span>;
};

// ─────────────────────────────────────────────────────────────
// Media inside a message bubble
// ─────────────────────────────────────────────────────────────
const MessageMedia = ({ urls, outbound }) => {
  if (!urls?.length) return null;

  const isImage = (u) => /\.(jpe?g|png|gif|webp|avif)(?:\?|$)/i.test(u);

  return (
    <div className="mt-1.5 space-y-1.5">
      {urls.map((u, i) =>
        isImage(u) ? (
          <a
            key={i}
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-md"
          >
            <img
              src={u}
              alt=""
              loading="lazy"
              className="block max-h-72 w-full max-w-xs object-cover"
            />
          </a>
        ) : (
          <a
            key={i}
            href={u}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-[11.5px] transition-colors ${
              outbound
                ? "bg-white/15 text-white hover:bg-white/25"
                : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-700"
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-black/10 dark:bg-white/10">
              {I.file("h-3.5 w-3.5")}
            </span>
            <span className="min-w-0 flex-1 truncate">Attachment</span>
            {I.external("h-3 w-3 shrink-0 opacity-60")}
          </a>
        )
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Single message bubble
// ─────────────────────────────────────────────────────────────
const MessageBubble = ({ message }) => {
  const outbound = message.direction === "out";
  const isFailed =
    message.status === "failed" || message.status === "undelivered";

  return (
    <div
      className={`flex w-full ${outbound ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-snug shadow-sm sm:max-w-[70%] ${
          outbound
            ? isFailed
              ? "bg-red-500 text-white"
              : "bg-teal-600 text-white dark:bg-teal-600"
            : "bg-white text-stone-800 ring-1 ring-stone-200 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700"
        }`}
      >
        {message.body ? (
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        ) : null}

        <MessageMedia urls={message.mediaUrls} outbound={outbound} />

        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            outbound ? "text-white/70" : "text-stone-400 dark:text-stone-500"
          }`}
        >
          <span>{formatTime(message.createdAt)}</span>
          {outbound ? <DeliveryTick status={message.status} /> : null}
        </div>

        {isFailed && message.errorMessage ? (
          <p className="mt-1 text-[10.5px] leading-snug text-white/90">
            {message.errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Conversation row (sidebar item)
// ─────────────────────────────────────────────────────────────
const ConversationRow = ({ conversation, active, onClick }) => {
  const display = conversation.contactName || formatPhone(conversation.contactPhone);
  const initials = initialsFor(conversation.contactName, conversation.contactPhone);
  const tint = avatarTint(conversation.contactPhone);
  const unread = conversation.unreadCount || 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-stone-100 px-3.5 py-3 text-left transition-colors dark:border-stone-800/60 ${
        active
          ? "bg-teal-50 dark:bg-teal-500/10"
          : "hover:bg-stone-50 dark:hover:bg-stone-900/60"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${tint}`}
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span
            className={`min-w-0 truncate text-[13.5px] ${
              unread > 0
                ? "font-semibold text-stone-900 dark:text-stone-100"
                : "font-medium text-stone-800 dark:text-stone-100"
            }`}
          >
            {display}
          </span>
          <span className="shrink-0 text-[10.5px] text-stone-400 dark:text-stone-500">
            {formatRelative(conversation.lastMessageAt)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span
            className={`min-w-0 truncate text-[11.5px] ${
              unread > 0
                ? "text-stone-700 dark:text-stone-300"
                : "text-stone-400 dark:text-stone-500"
            }`}
          >
            {conversation.lastMessagePreview || "No messages yet"}
          </span>
          {unread > 0 ? (
            <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-teal-600 px-1 text-[9.5px] font-bold text-white dark:bg-teal-500">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Compose bar
// ─────────────────────────────────────────────────────────────
const ComposeBar = ({ disabled, sending, onSend }) => {
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  // Auto-grow textarea up to ~4 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled || sending) return;
    onSend(t);
    setText("");
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="flex items-end gap-2 border-t border-stone-200/70 bg-white px-3 py-2.5 dark:border-stone-800/70 dark:bg-stone-950"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)" }}
    >
      <div className="flex min-w-0 flex-1 items-end rounded-lg border border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={disabled ? "Reconnect WhatsApp to send messages" : "Type a message"}
          className="min-h-[40px] w-full resize-none bg-transparent px-3 py-2.5 text-[13.5px] text-stone-900 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={disabled || sending || !text.trim()}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none dark:bg-teal-500 dark:hover:bg-teal-400 dark:disabled:bg-stone-800 dark:disabled:text-stone-600"
        aria-label="Send"
      >
        {sending ? I.spinner("h-4 w-4") : I.send("h-4 w-4")}
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// New chat modal
// ─────────────────────────────────────────────────────────────
const NewChatModal = ({ open, onClose, onStart }) => {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPhone("");
      setName("");
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    const clean = phone.replace(/[^\d+]/g, "");
    if (!clean || clean.replace(/\D/g, "").length < 6) {
      setError("Enter a valid phone number with country code.");
      return;
    }
    onStart({ phone: clean, name: name.trim() });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <form
        onSubmit={submit}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 pt-4 dark:border-stone-800 sm:px-5">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              New message
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Start a new WhatsApp conversation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div>
            <label
              htmlFor="wa-new-phone"
              className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
            >
              Phone number
            </label>
            <input
              id="wa-new-phone"
              type="tel"
              inputMode="tel"
              autoFocus
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError("");
              }}
              placeholder="+234 801 234 5678"
              className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
            />
          </div>
          <div>
            <label
              htmlFor="wa-new-name"
              className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
            >
              Name (optional)
            </label>
            <input
              id="wa-new-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="For your reference only"
              className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
            />
          </div>
          {error ? (
            <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-red-600 dark:text-red-400">
              {I.alert("h-3.5 w-3.5")}
              {error}
            </p>
          ) : null}
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!phone.trim()}
            className="rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            Start chat
          </button>
        </div>
      </form>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Empty / loading / not-connected states
// ─────────────────────────────────────────────────────────────
const LoadingScreen = ({ label = "Loading inbox…" }) => (
  <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-stone-950">
    <div className="flex flex-col items-center gap-3">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
      <p className="text-[12px] text-stone-400 dark:text-stone-500">{label}</p>
    </div>
  </div>
);

const NoConnectionScreen = () => {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white px-4 text-center dark:bg-stone-950">
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
        {I.whatsapp("h-6 w-6")}
      </span>
      <h1 className="text-[16px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        Connect WhatsApp first
      </h1>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
        You haven't linked a WhatsApp Business number to Xamut yet. Connect one
        to start sending and receiving messages.
      </p>
      <button
        type="button"
        onClick={() => navigate("/settings/whatsapp")}
        className="mt-1 rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] dark:bg-teal-500 dark:hover:bg-teal-400"
      >
        Go to WhatsApp settings
      </button>
    </div>
  );
};

const EmptyThread = () => (
  <div className="flex h-full flex-col items-center justify-center px-6 text-center">
    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500">
      {I.empty("h-7 w-7")}
    </span>
    <p className="mt-3 text-[13.5px] font-semibold text-stone-700 dark:text-stone-200">
      Select a conversation
    </p>
    <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
      Choose a thread on the left, or start a new one.
    </p>
  </div>
);

const EmptyConversations = () => (
  <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
      {I.empty("h-6 w-6")}
    </span>
    <p className="mt-3 text-[13.5px] font-semibold text-stone-700 dark:text-stone-200">
      No conversations yet
    </p>
    <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
      Start a new chat, or wait for someone to message your WhatsApp number.
    </p>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
const WhatsAppInbox = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  // The conversation id can come from the URL (deep link) or from
  // local state (when the user clicks a row). URL wins on first load.
  const urlConversationId = params.id || searchParams.get("c") || null;
  const [activeId, setActiveId] = useState(urlConversationId);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(!!urlConversationId);

  useEffect(() => {
    if (urlConversationId && urlConversationId !== activeId) {
      setActiveId(urlConversationId);
      setMobileThreadOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlConversationId]);

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [optimisticOutbound, setOptimisticOutbound] = useState({});

  // ── Connection check ────────────────────────────────────────
  const {
    data: connData,
    isLoading: connLoading,
  } = useGetWhatsappConnectionQuery();
  const connection = connData?.connection || null;
  const isConnected = connection?.status === "connected";

  // ── Conversations ───────────────────────────────────────────
  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    refetch: refetchConversations,
  } = useListWhatsappConversationsQuery(
    { page: 1, limit: 100 },
    {
      skip: !isConnected,
      pollingInterval: 15000,
      refetchOnFocus: true,
      refetchOnReconnect: true,
    }
  );

  const conversations = conversationsData?.conversations || [];

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = (c.contactName || "").toLowerCase();
      const phone = (c.contactPhone || "").toLowerCase();
      const preview = (c.lastMessagePreview || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || preview.includes(q);
    });
  }, [conversations, search]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c._id === activeId) || null,
    [conversations, activeId]
  );

  // ── Messages for active thread ──────────────────────────────
  const {
    data: messagesData,
    isLoading: messagesLoading,
    refetch: refetchMessages,
  } = useListWhatsappMessagesQuery(
    { conversationId: activeId, page: 1, limit: 200 },
    {
      skip: !activeId,
      pollingInterval: activeId ? 8000 : 0,
      refetchOnFocus: true,
    }
  );

  const messages = messagesData?.messages || [];

  // Combine real messages with any optimistic ones for this thread.
  const combinedMessages = useMemo(() => {
    const optim = optimisticOutbound[activeId] || [];
    return [...messages, ...optim];
  }, [messages, optimisticOutbound, activeId]);

  const grouped = useMemo(() => groupByDay(combinedMessages), [combinedMessages]);

  // Auto-scroll to bottom when messages change (only if user is at
  // the bottom — otherwise we'd yank them up while reading history).
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      atBottomRef.current = nearBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [combinedMessages.length, activeId]);

  // ── Send ────────────────────────────────────────────────────
  const [sendMessage, { isLoading: sending }] = useSendWhatsappMessageMutation();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const handleSend = async (text) => {
    if (!activeConversation || !isConnected) return;
    const conversationId = activeConversation._id;
    const to = activeConversation.contactPhone;

    // Optimistic message — shows immediately, replaced once the
    // mutation resolves and RTK Query refetches.
    const tempId = `optim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optimistic = {
      _id: tempId,
      direction: "out",
      body: text,
      mediaUrls: [],
      status: "queued",
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setOptimisticOutbound((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] || []), optimistic],
    }));
    atBottomRef.current = true;

    try {
      await sendMessage({
        to,
        body: text,
        conversationId,
      }).unwrap();

      // Server has the message now. Drop the optimistic copy and let
      // the invalidation-driven refetch land the real row.
      setOptimisticOutbound((prev) => {
        const next = { ...prev };
        next[conversationId] = (next[conversationId] || []).filter(
          (m) => m._id !== tempId
        );
        if (next[conversationId].length === 0) delete next[conversationId];
        return next;
      });

      // Belt and braces — sometimes the invalidation tag match is
      // slightly behind the mutation resolve.
      refetchMessages();
      refetchConversations();
    } catch (err) {
      // Keep the optimistic row but mark it failed so the user sees
      // the error right where the message would have been.
      setOptimisticOutbound((prev) => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map((m) =>
          m._id === tempId
            ? {
                ...m,
                status: "failed",
                errorMessage:
                  err?.data?.message || "Couldn't send. Try again.",
              }
            : m
        ),
      }));
      showToast(err?.data?.message || "Couldn't send message.");
    }
  };

  // ── New chat ────────────────────────────────────────────────
  const handleStartChat = (() => {
    // We don't have a "create conversation" endpoint — sending a
    // message to a new number creates the thread. The send endpoint
    // returns 201 and the conversation appears after invalidation.
    return async ({ phone }) => {
      try {
        await sendMessage({ to: phone, body: "" }).unwrap();
        // An empty body send is rejected by the backend; use a
        // placeholder that the user can replace.
      } catch {
        /* swallow — the user will type their first real message */
      }
      showToast("Conversation opened. Type your first message.");
      refetchConversations();
    };
  })();

  const selectConversation = (id) => {
    setActiveId(id);
    setMobileThreadOpen(true);
    // Keep URL in sync for reloads and back-button behaviour.
    if (params.id) return; // route already encodes the id
    const next = new URLSearchParams(searchParams);
    next.set("c", id);
    setSearchParams(next, { replace: true });
  };

  const closeMobileThread = () => {
    setMobileThreadOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete("c");
    setSearchParams(next, { replace: true });
  };

  // ── Render branches ─────────────────────────────────────────
  if (connLoading) return <LoadingScreen label="Checking connection…" />;
  if (!isConnected) return <NoConnectionScreen />;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      {/* ── Sidebar (conversation list) ───────────────────── */}
      <aside
        className={`flex h-full w-full shrink-0 flex-col border-r border-stone-200/70 bg-white dark:border-stone-800/70 dark:bg-stone-950 md:w-[340px] lg:w-[380px] ${
          mobileThreadOpen ? "hidden md:flex" : "flex"
        }`}
      >
        <header
          className="border-b border-stone-200/70 dark:border-stone-800/70"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/25">
              {I.whatsapp("h-4 w-4")}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Inbox
              </h1>
              <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                {connection?.phoneNumber ? formatPhone(connection.phoneNumber) : "WhatsApp"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setNewChatOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-teal-600 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-teal-400"
              aria-label="New chat"
            >
              {I.plus("h-4 w-4")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/settings/whatsapp")}
              className="hidden h-9 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-[11.5px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-400 sm:flex"
            >
              Settings
            </button>
          </div>

          <div className="px-3 pb-2.5 sm:px-4">
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500">
                {I.search("h-3.5 w-3.5")}
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="w-full rounded-md border border-stone-200 bg-stone-50 py-2 pl-8 pr-3 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:bg-stone-900"
              />
            </div>
          </div>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {conversationsLoading ? (
            <div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-stone-100 px-3.5 py-3 dark:border-stone-800/60"
                >
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-stone-100 dark:bg-stone-800/60" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            search ? (
              <div className="py-14 text-center">
                <p className="text-[12.5px] font-semibold text-stone-700 dark:text-stone-200">
                  No matches for "{search}"
                </p>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-2 text-[12px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <EmptyConversations />
            )
          ) : (
            filteredConversations.map((c) => (
              <ConversationRow
                key={c._id}
                conversation={c}
                active={c._id === activeId}
                onClick={() => selectConversation(c._id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Thread pane ──────────────────────────────────── */}
      <main
        className={`relative h-full min-w-0 flex-1 flex-col bg-stone-50 dark:bg-stone-950 ${
          mobileThreadOpen ? "flex" : "hidden md:flex"
        }`}
      >
        {!activeConversation ? (
          <EmptyThread />
        ) : (
          <>
            <header
              className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 bg-white px-2.5 dark:border-stone-800/70 dark:bg-stone-950 sm:px-4"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              <button
                type="button"
                onClick={closeMobileThread}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 md:hidden"
                aria-label="Back to conversations"
              >
                {I.back("h-4 w-4")}
              </button>

              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${avatarTint(
                  activeConversation.contactPhone
                )}`}
              >
                {initialsFor(
                  activeConversation.contactName,
                  activeConversation.contactPhone
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                  {activeConversation.contactName ||
                    formatPhone(activeConversation.contactPhone)}
                </p>
                <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                  {formatPhone(activeConversation.contactPhone)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate("/settings/whatsapp")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 md:hidden"
                aria-label="WhatsApp settings"
              >
                {I.whatsapp("h-4 w-4")}
              </button>
            </header>

            <div
              ref={scrollRef}
              className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-5"
            >
              {messagesLoading && combinedMessages.length === 0 ? (
                <div className="mx-auto max-w-lg space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`flex ${
                        i % 2 === 0 ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div className="h-10 w-40 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800/60" />
                    </div>
                  ))}
                </div>
              ) : combinedMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <p className="max-w-xs text-center text-[12.5px] leading-relaxed text-stone-400 dark:text-stone-500">
                    No messages yet. Say hello.
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-4">
                  {grouped.map((group) => (
                    <div key={group.day} className="space-y-2">
                      <div className="flex items-center justify-center">
                        <span className="rounded-full bg-white px-2.5 py-0.5 text-[10.5px] font-semibold text-stone-500 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700">
                          {formatDayLabel(group.date)}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {group.messages.map((m) => (
                          <MessageBubble key={m._id} message={m} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ComposeBar
              disabled={!isConnected || !activeConversation}
              sending={sending}
              onSend={handleSend}
            />
          </>
        )}
      </main>

      <NewChatModal
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        onStart={handleStartChat}
      />

      {toast ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
          style={{ bottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
        >
          <div className="pointer-events-auto max-w-sm rounded-md border border-stone-200/80 bg-stone-900 px-4 py-2.5 text-[12px] font-medium text-white shadow-xl shadow-stone-900/20 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default WhatsAppInbox;