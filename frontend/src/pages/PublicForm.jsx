// pages/PublicForm.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  useGetPublicFormQuery,
  useParticipantLoginMutation,
  useUploadFormMediaMutation,
  useSubmitResponseMutation,
  useRequestAccessMutation,
  useSaveDraftMutation,
  useGetDraftQuery,
  useClearDraftMutation,
  useGetPublicElectionResultsQuery,
} from "../features/formApiSlice";
import { useDocumentMeta } from "../hooks/useDocumentMeta";

// ─────────────────────────────────────────────────────────────
// Token storage helpers
// ─────────────────────────────────────────────────────────────
const tokenKey = (slug) => `participant_token_${slug}`;
const resultsKey = (slug) => `results_token_${slug}`;
const sessionKeyKey = (slug) => `draft_session_${slug}`;
const loginPromptKey = (slug) => `login_prompt_shown_${slug}`;

const safeStorage = (store) => ({
  get: (k) => {
    try {
      return store.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (v) store.setItem(k, v);
      else store.removeItem(k);
    } catch {
      /* noop */
    }
  },
});

const sessionStore = safeStorage(sessionStorage);
const localStore = safeStorage(localStorage);

const readToken = (slug) => sessionStore.get(tokenKey(slug));
const writeToken = (slug, token) => sessionStore.set(tokenKey(slug), token);

const readResultsToken = (slug) => sessionStore.get(resultsKey(slug));
const writeResultsToken = (slug, token) =>
  sessionStore.set(resultsKey(slug), token);

const readSessionKey = (slug) => {
  const existing = localStore.get(sessionKeyKey(slug));
  if (existing) return existing;
  const generated =
    "sk_" +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);
  localStore.set(sessionKeyKey(slug), generated);
  return generated;
};

// ─────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────
const MEDIA_TYPES = new Set(["image", "document", "file"]);

const mediaNoun = (type) =>
  type === "image" ? "image" : type === "document" ? "document" : "file";

const mediaAccept = (type) => {
  if (type === "image") return "image/*";
  if (type === "document")
    return ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip";
  return undefined;
};

const formatBytes = (bytes) => {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatCountdown = (targetIso) => {
  if (!targetIso) return "";
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
};

// ─────────────────────────────────────────────────────────────
// Brand mark — small icon used inline in headers/footers
// ─────────────────────────────────────────────────────────────
const XamutIcon = ({ className = "h-7 w-7" }) => (
  <img
    src="/xamut-icon.png"
    alt="Xamut"
    draggable={false}
    className={`${className} shrink-0 select-none object-contain dark:brightness-0 dark:invert`}
  />
);

// Full wordmark — used on standalone, centered screens
const XamutLogo = ({ className = "h-9 w-auto" }) => (
  <img
    src="/xamut-logo.png"
    alt="Xamut"
    draggable={false}
    className={`${className} shrink-0 select-none object-contain dark:brightness-0 dark:invert`}
  />
);

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const I = {
  check: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={c}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
    </svg>
  ),
  close: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  lock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" strokeLinecap="round" />
    </svg>
  ),
  eye: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 9 7a11.8 11.8 0 0 1-2.2 3.6M6.6 6.6C4 8.2 3 11 3 12c0 1.5 4 7 9 7 1.2 0 2.3-.3 3.3-.7" strokeLinecap="round" />
    </svg>
  ),
  alert: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
    </svg>
  ),
  info: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" strokeLinecap="round" />
    </svg>
  ),
  arrowUp: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  star: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  starOutline: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={c}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" strokeLinejoin="round" />
    </svg>
  ),
  trophy: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v3a3 3 0 0 1-3 3M7 5H4v3a3 3 0 0 0 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spinner: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`animate-spin ${c}`}>
      <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
    </svg>
  ),
  image: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  file: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
    </svg>
  ),
  upload: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  external: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ballot: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M4 20h16M6 20V10h12v10M10 6l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  ),
  crown: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <path d="M3 18h18l-1.5-9-4.5 3L12 6 9 12 4.5 9 3 18Z" />
    </svg>
  ),
  spark: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path
        d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  user: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" strokeLinecap="round" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Rating input (unchanged)
// ─────────────────────────────────────────────────────────────
const RatingInput = ({ value, min, max, onChange }) => {
  const items = [];
  for (let i = min; i <= max; i++) items.push(i);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((n) => {
        const active = value >= n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-10 w-10 items-center justify-center rounded-md border transition-all active:scale-95 ${
              active
                ? "border-amber-300 bg-amber-50 text-amber-500 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
                : "border-stone-200 bg-white text-stone-300 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-600 dark:hover:border-stone-600"
            }`}
            aria-label={`Rate ${n}`}
          >
            {active ? I.star("h-4 w-4") : I.starOutline("h-4 w-4")}
          </button>
        );
      })}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(0)}
          className="ml-1 text-[11.5px] font-semibold text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Linear scale input (unchanged)
// ─────────────────────────────────────────────────────────────
const ScaleInput = ({ value, min, max, onChange }) => {
  const items = [];
  for (let i = min; i <= max; i++) items.push(i);
  const compact = items.length > 7;

  return (
    <div className="scrollbar-none -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-1 sm:mx-0 sm:px-0">
      {items.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-10 shrink-0 items-center justify-center rounded-md border font-semibold transition-all active:scale-95 ${
              compact ? "w-10 text-[12.5px]" : "flex-1 text-[13px]"
            } ${
              active
                ? "border-teal-500 bg-teal-600 text-white shadow-sm shadow-teal-500/25 dark:border-teal-500 dark:bg-teal-500"
                : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800"
            }`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Media input (unchanged)
// ─────────────────────────────────────────────────────────────
const MediaInput = ({
  field,
  value,
  onChange,
  slug,
  participantToken,
  onUploadingChange,
  hasError,
}) => {
  const [uploadFile, { isLoading }] = useUploadFormMediaMutation();
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const maxFiles = Math.max(1, Number(field.validation?.maxFiles) || 1);
  const isMulti = maxFiles > 1;
  const current = value == null ? [] : Array.isArray(value) ? value : [value];
  const noun = mediaNoun(field.type);
  const accept = mediaAccept(field.type);
  const canAdd = current.length < maxFiles;

  useEffect(() => {
    onUploadingChange?.(field.id, isLoading);
  }, [isLoading, field.id, onUploadingChange]);

  const handlePick = () => inputRef.current?.click();

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;

    setError("");
    const remaining = maxFiles - current.length;
    const toUpload = files.slice(0, remaining);
    const uploaded = [];

    for (const file of toUpload) {
      try {
        const res = await uploadFile({ slug, file, participantToken }).unwrap();
        uploaded.push({
          url: res.url,
          filename: res.filename || file.name,
          size: res.size || file.size,
          mimetype: res.mimetype || file.type,
        });
      } catch (err) {
        setError(
          err?.data?.message || `Couldn't upload ${file.name || "that file"}.`
        );
        break;
      }
    }

    if (uploaded.length) {
      if (isMulti) onChange(field.id, [...current, ...uploaded]);
      else onChange(field.id, uploaded[0]);
    }
  };

  const handleRemove = (idx) => {
    if (isMulti) onChange(field.id, current.filter((_, i) => i !== idx));
    else onChange(field.id, null);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={isMulti}
        onChange={handleFiles}
        className="hidden"
      />

      {current.map((item, idx) => (
        <div
          key={`${item.url}-${idx}`}
          className="flex items-center gap-3 rounded-md border border-stone-200 bg-stone-50/50 p-2.5 dark:border-stone-700 dark:bg-stone-800/40"
        >
          {field.type === "image" ? (
            <img
              src={item.url}
              alt={item.filename || "Upload"}
              className="h-12 w-12 shrink-0 rounded object-cover ring-1 ring-stone-200 dark:ring-stone-700"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-white text-stone-400 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-500 dark:ring-stone-700">
              {I.file("h-5 w-5")}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-stone-800 dark:text-stone-100">
              {item.filename || "Uploaded file"}
            </p>
            <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
              {formatBytes(item.size) || "Uploaded"}
            </p>
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-teal-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-teal-400"
            title="Open in a new tab"
          >
            {I.external("h-3.5 w-3.5")}
          </a>

          <button
            type="button"
            onClick={() => handleRemove(idx)}
            className="shrink-0 rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
            aria-label="Remove file"
          >
            {I.close("h-3.5 w-3.5")}
          </button>
        </div>
      ))}

      {canAdd ? (
        <button
          type="button"
          onClick={handlePick}
          disabled={isLoading}
          className={`flex w-full items-center gap-3 rounded-md border-2 border-dashed px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
            hasError
              ? "border-red-300 bg-red-50/40 hover:bg-red-50 dark:border-red-500/40 dark:bg-red-500/5"
              : "border-stone-300 bg-white hover:border-teal-400 hover:bg-teal-50/50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-teal-500/60 dark:hover:bg-teal-500/10"
          }`}
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
              hasError
                ? "bg-red-100 text-red-500 dark:bg-red-500/20 dark:text-red-400"
                : "bg-teal-100 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400"
            }`}
          >
            {isLoading ? I.spinner("h-4 w-4") : I.upload("h-4 w-4")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
              {isLoading
                ? "Uploading…"
                : `Upload ${current.length ? "another " : ""}${noun}`}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-stone-400 dark:text-stone-500">
              {isMulti ? `Up to ${maxFiles} ${noun}s. ` : ""}
              {field.type === "image"
                ? "JPG, PNG, WEBP, GIF. Max 15MB."
                : field.type === "document"
                ? "PDF, DOC, XLS, PPT, TXT or ZIP. Max 15MB."
                : "Max 15MB."}
            </span>
          </span>
        </button>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-red-600 dark:text-red-400">
          {I.alert("h-3.5 w-3.5 shrink-0")}
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Field renderer (unchanged)
// ─────────────────────────────────────────────────────────────
const FieldRenderer = ({
  field,
  value,
  error,
  onChange,
  slug,
  participantToken,
  onUploadingChange,
}) => {
  const hasError = !!error;

  const baseInput =
    "w-full rounded-md border bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:ring-4 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500";
  const inputClass = `${baseInput} ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-500/10 dark:border-red-500/50"
      : "border-stone-200 focus:border-teal-400 focus:ring-teal-500/10 dark:border-stone-700 dark:focus:border-teal-500/60"
  }`;

  const choiceRowClass = (checked) =>
    `flex w-full items-center gap-3 rounded-md border px-3.5 py-2.5 text-left transition-all ${
      checked
        ? "border-teal-400 bg-teal-50/70 ring-2 ring-teal-500/10 dark:border-teal-500/60 dark:bg-teal-500/10 dark:ring-teal-500/20"
        : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600 dark:hover:bg-stone-800"
    }`;

  if (field.type === "section") {
    return (
      <div className="pt-1">
        <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {field.label}
        </h2>
        {field.description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
            {field.description}
          </p>
        ) : null}
      </div>
    );
  }

  const setValue = (v) => onChange(field.id, v);
  const valueStr = value == null ? "" : String(value);
  const arrayValue = Array.isArray(value) ? value : [];

  return (
    <div>
      <label className="mb-2 block">
        <span className="text-[13.5px] font-medium leading-snug text-stone-800 dark:text-stone-100">
          {field.label}
          {field.required ? (
            <span className="ml-1 text-teal-500 dark:text-teal-400">*</span>
          ) : null}
        </span>
        {field.description ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-stone-500 dark:text-stone-400">
            {field.description}
          </span>
        ) : null}
      </label>

      <div>
        {field.type === "short_text" ? (
          <input
            type="text"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "Your answer"}
            className={inputClass}
          />
        ) : null}

        {field.type === "long_text" ? (
          <textarea
            rows={4}
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "Your answer"}
            className={`${inputClass} resize-y leading-relaxed`}
          />
        ) : null}

        {field.type === "email" ? (
          <input
            type="email"
            inputMode="email"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "you@example.com"}
            className={inputClass}
          />
        ) : null}

        {field.type === "phone" ? (
          <input
            type="tel"
            inputMode="tel"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "+234 800 000 0000"}
            className={inputClass}
          />
        ) : null}

        {field.type === "url" ? (
          <input
            type="url"
            inputMode="url"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "https://…"}
            className={inputClass}
          />
        ) : null}

        {field.type === "number" ? (
          <input
            type="number"
            inputMode="numeric"
            value={valueStr}
            min={field.validation?.min ?? undefined}
            max={field.validation?.max ?? undefined}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder || "0"}
            className={inputClass}
          />
        ) : null}

        {field.type === "date" ? (
          <input
            type="date"
            value={valueStr ? String(valueStr).slice(0, 10) : ""}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
        ) : null}

        {field.type === "time" ? (
          <input
            type="time"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          />
        ) : null}

        {MEDIA_TYPES.has(field.type) ? (
          <MediaInput
            field={field}
            value={value}
            onChange={onChange}
            slug={slug}
            participantToken={participantToken}
            onUploadingChange={onUploadingChange}
            hasError={hasError}
          />
        ) : null}

        {field.type === "radio" ? (
          <div className="space-y-1.5">
            {field.options.map((opt) => {
              const checked = valueStr === opt.value;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setValue(opt.value)}
                  className={choiceRowClass(checked)}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      checked
                        ? "border-teal-500 dark:border-teal-400"
                        : "border-stone-300 dark:border-stone-600"
                    }`}
                  >
                    {checked ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-stone-800 dark:text-stone-100">
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {field.type === "checkbox" || field.type === "multi_select" ? (
          <div className="space-y-1.5">
            {field.options.map((opt) => {
              const checked = arrayValue.includes(opt.value);
              const toggle = () => {
                if (checked) setValue(arrayValue.filter((v) => v !== opt.value));
                else setValue([...arrayValue, opt.value]);
              };
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={toggle}
                  className={choiceRowClass(checked)}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      checked
                        ? "border-teal-500 bg-teal-500 dark:border-teal-500 dark:bg-teal-500"
                        : "border-stone-300 dark:border-stone-600"
                    }`}
                  >
                    {checked ? (
                      <span className="text-white">{I.check("h-2.5 w-2.5")}</span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-stone-800 dark:text-stone-100">
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {field.type === "dropdown" ? (
          <select
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {field.options.map((opt) => (
              <option key={opt.id} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : null}

        {field.type === "yes_no" ? (
          <div className="flex gap-2">
            {[
              { label: "Yes", val: true },
              { label: "No", val: false },
            ].map((opt) => {
              const checked = value === opt.val;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setValue(opt.val)}
                  className={`flex-1 rounded-md border px-4 py-2.5 text-[13.5px] font-semibold transition-all ${
                    checked
                      ? "border-teal-400 bg-teal-50 text-teal-700 ring-2 ring-teal-500/10 dark:border-teal-500/60 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/20"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {field.type === "rating" ? (
          <RatingInput
            value={Number(value) || 0}
            min={field.validation?.min ?? 1}
            max={field.validation?.max ?? 5}
            onChange={(n) => setValue(n)}
          />
        ) : null}

        {field.type === "scale" ? (
          <ScaleInput
            value={Number(value) || 0}
            min={field.validation?.min ?? 1}
            max={field.validation?.max ?? 10}
            onChange={(n) => setValue(n)}
          />
        ) : null}
      </div>

      {hasError ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-red-600 dark:text-red-400">
          {I.alert("h-3.5 w-3.5 shrink-0")}
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Election — candidate card
// ─────────────────────────────────────────────────────────────
const CandidateCard = ({ candidate, selected, disabled, onClick }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = candidate.bio || candidate.manifesto;

  return (
    <div
      className={`group overflow-hidden rounded-lg border-2 transition-all ${
        selected
          ? "border-rose-500 bg-rose-50/50 shadow-sm shadow-rose-500/15 dark:border-rose-500 dark:bg-rose-500/10"
          : "border-stone-200 bg-white hover:border-rose-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-rose-500/50"
      } ${disabled ? "opacity-60" : "cursor-pointer"}`}
    >
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <span className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose-100 text-[18px] font-semibold text-rose-700 ring-2 ring-white shadow dark:bg-rose-500/20 dark:text-rose-300 dark:ring-stone-900">
          {candidate.photoUrl ? (
            <img
              src={candidate.photoUrl}
              alt={candidate.name}
              className="h-full w-full object-cover"
            />
          ) : (
            (candidate.name || "?").charAt(0).toUpperCase()
          )}
          {selected ? (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow">
              {I.check("h-3 w-3")}
            </span>
          ) : null}
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[14px] font-semibold text-stone-900 dark:text-stone-100">
            {candidate.name || "Unnamed candidate"}
          </p>
          {candidate.slogan ? (
            <p className="mt-0.5 truncate text-[11.5px] italic text-stone-500 dark:text-stone-400">
              "{candidate.slogan}"
            </p>
          ) : null}
          {candidate.bio && !expanded ? (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">
              {candidate.bio}
            </p>
          ) : null}
        </div>
      </button>

      {hasDetails ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="flex w-full items-center justify-between border-t border-stone-100 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-stone-400 transition-colors hover:bg-stone-50 dark:border-stone-800 dark:text-stone-500 dark:hover:bg-stone-800/50"
        >
          {expanded ? "Hide details" : "Show details"}
          <span className={expanded ? "rotate-180" : ""}>▾</span>
        </button>
      ) : null}

      {expanded && hasDetails ? (
        <div className="border-t border-stone-100 px-3 py-3 dark:border-stone-800">
          {candidate.bio ? (
            <div className="mb-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Bio
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
                {candidate.bio}
              </p>
            </div>
          ) : null}
          {candidate.manifesto ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Manifesto
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
                {candidate.manifesto}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Election — one position
// ─────────────────────────────────────────────────────────────
const PositionVoter = ({ position, value, error, onChange, allowAbstain }) => {
  const maxSel = Math.max(1, position.maxSelections || 1);
  const current = Array.isArray(value) ? value : value ? [value] : [];
  const atMax = current.length >= maxSel;

  const toggle = (candidateId) => {
    if (current.includes(candidateId)) {
      onChange(position.id, current.filter((v) => v !== candidateId));
      return;
    }
    if (maxSel === 1) {
      onChange(position.id, [candidateId]);
      return;
    }
    if (atMax) return;
    onChange(position.id, [...current, candidateId]);
  };

  const clear = () => onChange(position.id, []);

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="border-b border-stone-100 bg-gradient-to-r from-rose-50/60 to-white px-4 py-3 dark:border-stone-800 dark:from-rose-500/5 dark:to-stone-900 sm:px-5">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
            {I.ballot("h-3.5 w-3.5")}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100">
              {position.title}
              {position.required && !allowAbstain ? (
                <span className="ml-1 text-rose-500 dark:text-rose-400">*</span>
              ) : null}
            </h3>
            {position.description ? (
              <p className="mt-0.5 text-[12px] leading-snug text-stone-500 dark:text-stone-400">
                {position.description}
              </p>
            ) : null}
            <p className="mt-1 text-[10.5px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-400">
              {maxSel === 1
                ? "Pick one"
                : `Pick up to ${maxSel}`}
              {current.length > 0 ? ` · ${current.length} selected` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 p-3 sm:grid-cols-2 sm:p-4">
        {position.candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            selected={current.includes(c.id)}
            disabled={!current.includes(c.id) && maxSel > 1 && atMax}
            onClick={() => toggle(c.id)}
          />
        ))}
      </div>

      {allowAbstain || current.length > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-2 dark:border-stone-800">
          {current.length > 0 ? (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              {current.length} of {maxSel} selected
            </p>
          ) : (
            <p className="text-[11px] italic text-stone-400 dark:text-stone-500">
              {allowAbstain ? "You can skip this position." : ""}
            </p>
          )}
          {current.length > 0 ? (
            <button
              type="button"
              onClick={clear}
              className="text-[11px] font-semibold text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1.5 border-t border-red-100 bg-red-50/70 px-4 py-2 text-[11.5px] font-medium text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {I.alert("h-3.5 w-3.5 shrink-0")}
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Election — live results panel
// ─────────────────────────────────────────────────────────────
const LiveResultsPanel = ({ slug, resultsToken }) => {
  const { data, isLoading } = useGetPublicElectionResultsQuery(
    { slug, resultsToken },
    { skip: !slug || !resultsToken, pollingInterval: 20000 }
  );

  if (isLoading) {
    return (
      <div className="mt-5 rounded-lg border border-rose-200/70 bg-rose-50/50 p-4 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-rose-700 dark:text-rose-300">
          {I.spinner("h-3.5 w-3.5")}
          Loading live results…
        </span>
      </div>
    );
  }

  if (!data?.results?.length) return null;

  return (
    <div className="mt-5 space-y-3">
      <div className="rounded-lg border border-rose-200/70 bg-rose-50/50 px-3.5 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
        <div className="flex items-center gap-2">
          <span className="text-rose-500 dark:text-rose-400">
            {I.ballot("h-4 w-4")}
          </span>
          <p className="text-[12px] font-semibold text-rose-800 dark:text-rose-200">
            Live standings · {data.totalResponses} vote
            {data.totalResponses === 1 ? "" : "s"}
          </p>
        </div>
        <p className="mt-1 text-[10.5px] text-rose-600/80 dark:text-rose-400/80">
          Updates as people vote. Only visible to those who've voted.
        </p>
      </div>

      {data.results.map((p) => (
        <div
          key={p.positionId}
          className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-[13.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                {p.title}
              </p>
              <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {p.totalVotes} vote{p.totalVotes === 1 ? "" : "s"}
                {p.abstained > 0 ? ` · ${p.abstained} abstained` : ""}
              </p>
            </div>
            {p.tie && p.totalVotes > 0 ? (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                Tie
              </span>
            ) : null}
          </div>

          {p.totalVotes === 0 ? (
            <p className="text-[12px] text-stone-400 dark:text-stone-500">
              No votes yet.
            </p>
          ) : (
            <div className="space-y-2.5">
              {p.candidates.map((c) => {
                const isWinner = p.winners?.includes(c.candidateId);
                return (
                  <div key={c.candidateId} className="flex items-center gap-3">
                    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose-100 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                      {c.photoUrl ? (
                        <img src={c.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (c.name || "?").charAt(0).toUpperCase()
                      )}
                      {isWinner ? (
                        <span
                          className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-white shadow ${
                            p.tie ? "bg-amber-400" : "bg-amber-500"
                          }`}
                        >
                          {I.crown("h-2.5 w-2.5")}
                        </span>
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-[12px] font-medium text-stone-800 dark:text-stone-100">
                          {c.name || "Unnamed"}
                        </span>
                        <span className="shrink-0 text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                          {c.count}
                          <span className="ml-1.5 font-normal text-stone-400 dark:text-stone-500">
                            {c.percentage}%
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isWinner
                              ? p.tie
                                ? "bg-amber-400"
                                : "bg-rose-500 dark:bg-rose-400"
                              : "bg-stone-400 dark:bg-stone-500"
                          }`}
                          style={{ width: `${Math.max(2, c.percentage)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Participant login / request access screen
// ─────────────────────────────────────────────────────────────
const ParticipantLogin = ({ slug, onSuccess, formTitle, canRequest, autoApprove, requestFields }) => {
  const [mode, setMode] = useState("login"); // "login" | "request"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [requestName, setRequestName] = useState("");
  const [extraInfo, setExtraInfo] = useState({});
  const [error, setError] = useState("");
  const [requestSent, setRequestSent] = useState(null);

  const [login, { isLoading: loggingIn }] = useParticipantLoginMutation();
  const [requestAccess, { isLoading: requesting }] = useRequestAccessMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (mode === "login") {
      if (!email.trim() || !password) {
        setError("Enter your email and password.");
        return;
      }
      try {
        const res = await login({
          slug,
          email: email.trim().toLowerCase(),
          password,
        }).unwrap();
        writeToken(slug, res.token);
        onSuccess(res.token, res.participant);
      } catch (err) {
        setError(err?.data?.message || "Invalid email or password.");
      }
    } else {
      if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        setError("Enter a valid email.");
        return;
      }
      for (const rf of requestFields || []) {
        const v = extraInfo[rf.id];
        const empty = v == null || v === "";
        if (rf.required && empty) {
          setError(`"${rf.label}" is required.`);
          return;
        }
      }
      try {
        const res = await requestAccess({
          slug,
          email: email.trim().toLowerCase(),
          name: requestName.trim(),
          note: requestNote.trim(),
          extraInfo,
        }).unwrap();
        setRequestSent(res);
      } catch (err) {
        setError(err?.data?.message || "Couldn't send the request.");
      }
    }
  };

  const busy = loggingIn || requesting;

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="mb-6 flex justify-center">
          <XamutLogo className="h-9 w-auto sm:h-10" />
        </div>

        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-stone-100 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
            {I.lock("h-3 w-3")}
            Private form
          </span>
          <h1 className="mt-3 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[22px]">
            {formTitle || "Sign in to continue"}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            {mode === "login"
              ? "Enter the email and password from your invite email."
              : "Ask the organiser for access. You'll get an email once approved."}
          </p>
        </div>

        {canRequest ? (
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-stone-200 bg-white p-1 dark:border-stone-800 dark:bg-stone-900">
            {[
              { id: "login", label: "I have a password" },
              { id: "request", label: "Request access" },
            ].map((t) => {
              const active = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setMode(t.id);
                    setError("");
                    setRequestSent(null);
                  }}
                  className={`rounded px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                      : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-6"
        >
          {requestSent ? (
            <div className="text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                {I.check("h-5 w-5")}
              </div>
              <h2 className="mt-3 text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                {requestSent.autoApproved
                  ? "Access granted"
                  : "Request sent"}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                {requestSent.message ||
                  "Check your email for credentials or approval."}
              </p>
              {requestSent.autoApproved ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setRequestSent(null);
                  }}
                  className="mt-4 rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  Sign in with my password
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {error ? (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                  <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="participant-email"
                    className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
                  >
                    Email
                  </label>
                  <input
                    id="participant-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="you@example.com"
                    className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
                  />
                </div>

                {mode === "login" ? (
                  <div>
                    <label
                      htmlFor="participant-password"
                      className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="participant-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="off"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (error) setError("");
                        }}
                        placeholder="Your invite password"
                        className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 pr-11 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                        aria-label={showPassword ? "Hide" : "Show"}
                      >
                        {showPassword ? I.eyeOff("h-4 w-4") : I.eye("h-4 w-4")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Name <span className="text-stone-300 dark:text-stone-600">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={requestName}
                        onChange={(e) => setRequestName(e.target.value)}
                        placeholder="Your name"
                        className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
                      />
                    </div>

                    {(requestFields || []).map((rf) => (
                      <div key={rf.id}>
                        <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                          {rf.label}
                          {rf.required ? (
                            <span className="ml-1 text-teal-500">*</span>
                          ) : null}
                        </label>
                        <input
                          type={rf.type === "email" ? "email" : rf.type === "number" ? "number" : "text"}
                          value={extraInfo[rf.id] || ""}
                          onChange={(e) =>
                            setExtraInfo((prev) => ({ ...prev, [rf.id]: e.target.value }))
                          }
                          placeholder={rf.placeholder || ""}
                          className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
                        />
                      </div>
                    ))}

                    <div>
                      <label className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        Note{" "}
                        <span className="text-stone-300 dark:text-stone-600">(optional)</span>
                      </label>
                      <textarea
                        rows={2}
                        value={requestNote}
                        onChange={(e) => setRequestNote(e.target.value)}
                        placeholder="Why should you have access?"
                        className="w-full resize-none rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60"
                      />
                    </div>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="mt-5 w-full rounded-md bg-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
              >
                {busy ? (
                  <span className="inline-flex items-center gap-2">
                    {I.spinner("h-3.5 w-3.5")}
                    {mode === "login" ? "Signing in…" : "Sending…"}
                  </span>
                ) : mode === "login" ? (
                  "Continue"
                ) : autoApprove ? (
                  "Request access"
                ) : (
                  "Send request"
                )}
              </button>

              <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400 dark:text-stone-500">
                This isn't a Xamut account. Use the credentials from your invite
                email.
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Time window screen (not started / ended)
// ─────────────────────────────────────────────────────────────
const WindowScreen = ({ reason, message, startAt, expiresAt, formMeta }) => {
  const [countdown, setCountdown] = useState("");
  const target = reason === "not_started" ? startAt : null;

  useEffect(() => {
    if (!target) return;
    const update = () => setCountdown(formatCountdown(target));
    update();
    const t = setInterval(update, 30000);
    return () => clearInterval(t);
  }, [target]);

  const isEnded = reason === "ended" || reason === "closed";
  const isNotStarted = reason === "not_started";

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <XamutLogo className="h-9 w-auto sm:h-10" />
        <div
          className={`mt-5 flex h-12 w-12 items-center justify-center rounded-full ${
            isEnded
              ? "bg-red-100 text-red-500 dark:bg-red-500/20 dark:text-red-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
          }`}
        >
          {I.clock("h-6 w-6")}
        </div>

        <h1 className="mt-4 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {formMeta?.title || "This form"}
        </h1>

        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
          {message ||
            (isNotStarted
              ? "This form hasn't started yet. Check back soon."
              : "This form has ended. Responses are no longer accepted.")}
        </p>

        {isNotStarted && countdown ? (
          <div className="mt-5 rounded-lg border border-amber-200/70 bg-amber-50/60 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Starts in
            </p>
            <p className="mt-1 text-[20px] font-bold text-amber-700 dark:text-amber-300">
              {countdown}
            </p>
            {startAt ? (
              <p className="mt-1 text-[10.5px] text-amber-600/80 dark:text-amber-400/80">
                {new Date(startAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {isEnded && expiresAt ? (
          <p className="mt-4 text-[11.5px] text-stone-400 dark:text-stone-500">
            Ended{" "}
            {new Date(expiresAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Submitted screen
// ─────────────────────────────────────────────────────────────
const SubmittedScreen = ({ form, result, isElection, slug }) => {
  const showScore = !isElection && result?.score;
  const redirectUrl = result?.successRedirectUrl || "";
  const resultsToken =
    isElection && result?.resultsToken ? result.resultsToken : null;

  const [persistedToken] = useState(() => {
    if (resultsToken) {
      writeResultsToken(slug, resultsToken);
      return resultsToken;
    }
    return readResultsToken(slug);
  });

  useEffect(() => {
    if (!redirectUrl) return;
    const t = setTimeout(() => {
      window.location.href = redirectUrl;
    }, 2500);
    return () => clearTimeout(t);
  }, [redirectUrl]);

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="rounded-lg border border-stone-200/80 bg-white p-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm shadow-emerald-500/25">
            <span className="text-white">{I.check("h-6 w-6")}</span>
          </div>

          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[22px]">
            {isElection ? "Vote recorded" : "All done"}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">
            {result?.confirmationMessage ||
              form?.settings?.confirmationMessage ||
              (isElection
                ? "Thanks for voting!"
                : "Thanks, your response has been recorded.")}
          </p>

          {showScore ? (
            <div className="mt-5 rounded-lg border border-purple-200/70 bg-purple-50/50 p-4 dark:border-purple-500/30 dark:bg-purple-500/10">
              <div className="flex items-center justify-center gap-2 text-purple-600 dark:text-purple-400">
                {I.trophy("h-4 w-4")}
                <p className="text-[11px] font-semibold uppercase tracking-wider">
                  Your score
                </p>
              </div>
              <p className="mt-2 text-[30px] font-bold leading-none tracking-tight text-purple-700 dark:text-purple-300">
                {result.score.percentage}%
              </p>
              <p className="mt-1.5 text-[12px] text-purple-700/80 dark:text-purple-400/80">
                {result.score.totalScore} out of {result.score.maxScore} points
              </p>
              {result.score.passed !== null &&
              result.score.passed !== undefined ? (
                <p
                  className={`mt-2 inline-block rounded-md px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider ${
                    result.score.passed
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300"
                  }`}
                >
                  {result.score.passed ? "Passed" : "Failed"}
                </p>
              ) : null}
            </div>
          ) : null}

          {redirectUrl ? (
            <div className="mt-5 rounded-md border border-teal-200/70 bg-teal-50/60 px-3.5 py-3 text-left dark:border-teal-500/30 dark:bg-teal-500/10">
              <p className="text-[12px] leading-relaxed text-teal-800 dark:text-teal-300">
                Taking you somewhere next…
              </p>
              <div className="mt-2 flex items-center gap-2">
                <a
                  href={redirectUrl}
                  className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-colors hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {I.external("h-3.5 w-3.5")}
                  Go now
                </a>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex justify-center">
            <XamutIcon className="h-7 w-7" />
          </div>
          <p className="mt-2 text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Made with Xamut
          </p>
        </div>

        {/* Live results — elections only, when the owner enabled it */}
        {isElection && persistedToken ? (
          <LiveResultsPanel slug={slug} resultsToken={persistedToken} />
        ) : null}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Fatal error / Loading (unchanged)
// ─────────────────────────────────────────────────────────────
const FatalScreen = ({ title, message, status }) => {
  const isMissing = status === 404;
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <XamutLogo className="h-9 w-auto sm:h-10" />
        <h1 className="mt-5 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {title || (isMissing ? "Form not found" : "Something went wrong")}
        </h1>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
          {message ||
            (isMissing
              ? "The link may be wrong or the form was deleted."
              : "Please try again in a moment.")}
        </p>
      </div>
    </div>
  );
};

const LoadingScreen = ({ label = "Loading form…" }) => (
  <div className="flex min-h-dvh items-center justify-center bg-stone-50 dark:bg-stone-950">
    <div className="flex flex-col items-center gap-3">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
      <p className="text-[12px] text-stone-400 dark:text-stone-500">{label}</p>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Login prompt — soft popup offering to save via Xamut account
// ─────────────────────────────────────────────────────────────
const LoginPromptModal = ({ open, onClose, onContinue }) => {
  const navigate = useNavigate();
  const [dontAsk, setDontAsk] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-sm rounded-t-xl bg-white p-5 shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/25">
            {I.user("h-5 w-5")}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Save your progress?
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              Sign in to Xamut to save answers across devices and see this form
              in your dashboard. You can also just keep filling it out.
            </p>
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer select-none items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-stone-300 text-teal-500 focus:ring-teal-500/30 dark:border-stone-600"
          />
          Don't ask me again on this browser
        </label>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => {
              if (dontAsk) localStore.set(loginPromptKey(slugSafe()), "1");
              onContinue?.();
            }}
            className="flex-1 rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            Continue without signing in
          </button>
          <button
            type="button"
            onClick={() => {
              if (dontAsk) localStore.set(loginPromptKey(slugSafe()), "1");
              const back = encodeURIComponent(window.location.pathname);
              navigate(`/signin?next=${back}`);
            }}
            className="flex-1 rounded-md border border-stone-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-stone-700 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          >
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
};

// tiny helper so LoginPromptModal can call set without needing slug prop
const slugSafe = () => window.location.pathname.split("/").pop() || "";

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const FORM_ID = "public-form";

const PublicForm = () => {
  const { slug } = useParams();

  const [participantToken, setParticipantToken] = useState(() => readToken(slug));
  const [participantInfo, setParticipantInfo] = useState(null);
  const [needLogin, setNeedLogin] = useState(false);

  const { data: formData, isLoading, error, refetch } = useGetPublicFormQuery(
    { slug, participantToken },
    { skip: !slug }
  );

  const [submit, { isLoading: submitting }] = useSubmitResponseMutation();
  const [saveDraft] = useSaveDraftMutation();
  const [clearDraft] = useClearDraftMutation();

  const form = formData?.form;
  const isElection = form?.type === "election";

  useDocumentMeta({
  title: form?.title ? `${form.title} — Xamut` : undefined,
  description: form?.description || undefined,
  image: form?.coverPhoto || undefined,
  url: typeof window !== "undefined" ? window.location.href : undefined,
});

  // ── Handle auth / window errors from the query ─────────────
  useEffect(() => {
    if (error?.status === 401 && error?.data?.requiresAuth) {
      setNeedLogin(true);
      writeToken(slug, null);
      setParticipantToken(null);
    }
  }, [error, slug]);

  useEffect(() => {
    if (formData?.participant) {
      setParticipantInfo(formData.participant);
      setNeedLogin(false);
    }
  }, [formData]);

  // ── Local answer state ─────────────────────────────────────
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [startedAt] = useState(() => new Date().toISOString());
  const [showJump, setShowJump] = useState(false);
  const [uploadingFields, setUploadingFields] = useState(() => new Set());

  // ── Draft state ────────────────────────────────────────────
  const sessionKey = useMemo(() => readSessionKey(slug), [slug]);
  const draftLoadedRef = useRef(false);
  const [draftStatus, setDraftStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  const [draftRestoredAt, setDraftRestoredAt] = useState(null);
  const saveTimerRef = useRef(null);

  const { data: draftData } = useGetDraftQuery(
    { slug, sessionKey, participantToken },
    { skip: !slug || !sessionKey }
  );

  // Restore draft once
  useEffect(() => {
    if (draftLoadedRef.current) return;
    if (!draftData) return;
    const d = draftData.draft;
    if (d?.answers && Object.keys(d.answers).length) {
      setAnswers(d.answers);
      setDraftRestoredAt(d.updatedAt || new Date().toISOString());
    }
    draftLoadedRef.current = true;
  }, [draftData]);

  // Autosave — debounced 1.2s after last change
  useEffect(() => {
    if (!form) return;
    if (submitted) return;
    if (!Object.keys(answers).length) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setDraftStatus("saving");
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveDraft({
          slug,
          sessionKey,
          participantToken,
          answers,
          startedAt,
        }).unwrap();
        setDraftStatus("saved");
      } catch {
        setDraftStatus("error");
      }
    }, 1200);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [answers, form, slug, sessionKey, participantToken, startedAt, submitted, saveDraft]);

  // ── Login prompt — shown once per slug, unless user said don't ask ──
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);

  useEffect(() => {
    if (!form) return;
    if (promptDismissed) return;
    if (form.visibility === "private") return; // they already have their own flow
    if (localStore.get(loginPromptKey(slug)) === "1") return;
    // Show only if the current user isn't already logged in
    const userInfo = localStore.get("userInfo");
    if (userInfo) return;
    const t = setTimeout(() => setShowLoginPrompt(true), 1200);
    return () => clearTimeout(t);
  }, [form, slug, promptDismissed]);

  const anyUploading = uploadingFields.size > 0;

  useEffect(() => {
    const onScroll = () => setShowJump(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleUploadingChange = useMemo(
    () => (fieldId, isUploading) => {
      setUploadingFields((prev) => {
        const has = prev.has(fieldId);
        if (isUploading && has) return prev;
        if (!isUploading && !has) return prev;
        const next = new Set(prev);
        if (isUploading) next.add(fieldId);
        else next.delete(fieldId);
        return next;
      });
    },
    []
  );

  // ── Validation ─────────────────────────────────────────────
  const validate = () => {
    if (!form) return true;
    const errs = {};

    if (isElection) {
      const allowAbstain = !!form.settings?.allowAbstain;
      for (const p of form.positions || []) {
        const v = answers[p.id];
        const isEmpty =
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (p.required && !allowAbstain && isEmpty) {
          errs[p.id] = "Select a candidate.";
        }
      }
      setErrors(errs);
      return Object.keys(errs).length === 0;
    }

    for (const f of form.fields || []) {
      if (f.type === "section") continue;
      const v = answers[f.id];
      const isEmpty =
        v === undefined ||
        v === null ||
        v === "" ||
        (Array.isArray(v) && v.length === 0);

      if (f.required && isEmpty) {
        errs[f.id] = "This is required.";
        continue;
      }
      if (isEmpty) continue;

      if (
        f.type === "email" &&
        !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))
      ) {
        errs[f.id] = "Enter a valid email.";
      }

      if (f.type === "url") {
        try {
          new URL(String(v));
        } catch {
          errs[f.id] = "Enter a valid URL.";
        }
      }

      if (
        (f.type === "short_text" || f.type === "long_text") &&
        f.validation?.minLength &&
        String(v).length < f.validation.minLength
      ) {
        errs[f.id] = `At least ${f.validation.minLength} characters.`;
      }
      if (
        (f.type === "short_text" || f.type === "long_text") &&
        f.validation?.maxLength &&
        String(v).length > f.validation.maxLength
      ) {
        errs[f.id] = `At most ${f.validation.maxLength} characters.`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleChange = (fieldId, value) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");

    if (anyUploading) {
      setSubmitError("Please wait for uploads to finish before submitting.");
      return;
    }

    if (!validate()) {
      const firstErrorId = Object.keys(errors)[0];
      if (firstErrorId) {
        const el = document.querySelector(`[data-field-id="${firstErrorId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const started = new Date(startedAt).getTime();
    const durationSeconds = Math.round((Date.now() - started) / 1000);

    try {
      const res = await submit({
        slug,
        participantToken,
        answers,
        startedAt,
        durationSeconds,
      }).unwrap();

      // Clear draft locally and on server (server also does it, but be safe)
      try {
        await clearDraft({ slug, sessionKey, participantToken }).unwrap();
      } catch {
        /* noop */
      }

      setSubmitted(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const msg =
        err?.data?.message || err?.message || "Couldn't submit. Try again.";
      setSubmitError(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // ── Render branches ────────────────────────────────────────
  if (isLoading && !form) {
    const data = error?.data;
    if (error?.status === 410 && data?.reason) {
      return (
        <WindowScreen
          reason={data.reason}
          message={data.message}
          startAt={data.startAt}
          expiresAt={data.expiresAt}
          formMeta={data.formMeta}
        />
      );
    }
    return <LoadingScreen />;
  }

  // 410 from refetch after initial load (e.g. window just closed)
  if (error?.status === 410 && error?.data?.reason) {
    return (
      <WindowScreen
        reason={error.data.reason}
        message={error.data.message}
        startAt={error.data.startAt}
        expiresAt={error.data.expiresAt}
        formMeta={error.data.formMeta || { title: form?.title }}
      />
    );
  }

  // Private form + needLogin (either no form loaded yet or form was loaded as meta)
  if (
    (needLogin && !form) ||
    (error?.status === 401 && error?.data?.requiresAuth)
  ) {
    const meta = error?.data?.formMeta || {};
    return (
      <ParticipantLogin
        slug={slug}
        formTitle={meta.title}
        canRequest={!!error?.data?.canRequestAccess}
        autoApprove={!!error?.data?.autoApprove}
        requestFields={error?.data?.requestFields || []}
        onSuccess={(token, participant) => {
          setParticipantToken(token);
          setParticipantInfo(participant);
          setNeedLogin(false);
          refetch();
        }}
      />
    );
  }

  if (error && !form) return <FatalScreen status={error?.status} />;
  if (!form) return <FatalScreen status={404} />;
  if (submitted)
    return (
      <SubmittedScreen
        form={form}
        result={submitted}
        isElection={isElection}
        slug={slug}
      />
    );

  if (form.visibility === "private" && !participantToken) {
    return (
      <ParticipantLogin
        slug={slug}
        formTitle={form.title}
        canRequest={!!form.settings?.allowAccessRequests}
        autoApprove={!!form.settings?.autoApproveAccess}
        requestFields={form.settings?.requestFields || []}
        onSuccess={(token, participant) => {
          setParticipantToken(token);
          setParticipantInfo(participant);
          setNeedLogin(false);
        }}
      />
    );
  }

  // ── Progress computation (fields or positions) ─────────────
  const visibleFields = form.fields || [];
  const positions = form.positions || [];
  const totalItems = isElection
    ? positions.length
    : visibleFields.filter((f) => f.type !== "section").length;

  const answeredItems = isElection
    ? positions.filter((p) => {
        const v = answers[p.id];
        return !(
          v === undefined ||
          v === null ||
          v === "" ||
          (Array.isArray(v) && v.length === 0)
        );
      }).length
    : visibleFields
        .filter((f) => f.type !== "section")
        .filter((f) => {
          const v = answers[f.id];
          return !(
            v === undefined ||
            v === null ||
            v === "" ||
            (Array.isArray(v) && v.length === 0)
          );
        }).length;

  const requiredItems = isElection
    ? positions.filter((p) => p.required).length
    : visibleFields.filter((f) => f.type !== "section" && f.required).length;

  const answeredRequiredItems = isElection
    ? positions.filter((p) => {
        const v = answers[p.id];
        return (
          p.required &&
          !(
            v === undefined ||
            v === null ||
            v === "" ||
            (Array.isArray(v) && v.length === 0)
          )
        );
      }).length
    : visibleFields
        .filter((f) => f.type !== "section" && f.required)
        .filter((f) => {
          const v = answers[f.id];
          return !(
            v === undefined ||
            v === null ||
            v === "" ||
            (Array.isArray(v) && v.length === 0)
          );
        }).length;

  const progress = totalItems
    ? Math.round((answeredItems / totalItems) * 100)
    : 0;
  const requiredLeft = requiredItems - answeredRequiredItems;

  const showProgress = form.settings?.showProgressBar !== false;
  const hasContent = isElection ? positions.length > 0 : visibleFields.length > 0;
  const showMobileProgress = showProgress && totalItems > 0;

  const startAtMs = form.startAt ? new Date(form.startAt).getTime() : 0;
  const notStartedYet = startAtMs && startAtMs > Date.now();

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-30 bg-stone-50/90 backdrop-blur-xl dark:bg-stone-950/90"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-2.5 px-3 sm:h-14 sm:px-6">
          <XamutIcon className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {form.title}
            </p>
            <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
              {showProgress ? `${progress}% complete` : "Form in progress"}
              {requiredLeft > 0
                ? ` · ${requiredLeft} required left`
                : requiredItems > 0
                ? " · ready to submit"
                : ""}
            </p>
          </div>

          {/* Draft status chip */}
          {draftStatus === "saving" ? (
            <span className="hidden items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-[10px] font-semibold text-stone-500 dark:bg-stone-800 dark:text-stone-400 sm:inline-flex">
              {I.spinner("h-3 w-3")}
              Saving
            </span>
          ) : draftStatus === "saved" ? (
            <span className="hidden items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 sm:inline-flex">
              {I.check("h-2.5 w-2.5")}
              Saved
            </span>
          ) : null}

          {form.visibility === "private" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              {I.lock("h-3 w-3")}
              Private
            </span>
          ) : null}
        </div>

        {showMobileProgress ? (
          <div className="h-1 w-full bg-stone-200 dark:bg-stone-800 lg:hidden">
            <div
              className="h-full bg-teal-500 transition-[width] duration-300 ease-out dark:bg-teal-400"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        ) : null}

        <div className="border-b border-stone-200/70 dark:border-stone-800/70" />
      </header>

      {/* Content */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-3 pt-4 pb-28 sm:px-6 sm:pt-6 lg:pb-16">
        {/* Draft restored notice */}
        {draftRestoredAt ? (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <span className="mt-0.5 shrink-0">{I.info("h-3.5 w-3.5")}</span>
            <span>
              We found an unsaved draft from earlier and restored your answers.
            </span>
          </div>
        ) : null}

        {form.coverPhoto ? (
          <div className="mb-4 overflow-hidden rounded-lg border border-stone-200/80 shadow-sm dark:border-stone-800 sm:mb-5">
            <img
              src={form.coverPhoto}
              alt=""
              className="block h-36 w-full object-cover sm:h-48 md:h-56"
            />
          </div>
        ) : null}

        <div className="mb-5 sm:mb-6">
          <div className="flex items-center gap-2">
            {isElection ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                {I.ballot("h-3 w-3")}
                Election
              </span>
            ) : null}
          </div>
          <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100 sm:text-[28px]">
            {form.title}
          </h1>
          {form.description ? (
            <p className="mt-2 max-w-3xl whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              {form.description}
            </p>
          ) : null}
          {form.visibility === "private" && participantInfo?.email ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              {I.check("h-3 w-3")}
              Signed in as{" "}
              <span className="font-semibold">{participantInfo.email}</span>
            </p>
          ) : null}
          {notStartedYet ? (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              {I.clock("h-3 w-3")}
              Starts in {formatCountdown(form.startAt)}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px] lg:gap-6">
          <form id={FORM_ID} onSubmit={handleSubmit} className="min-w-0">
            {submitError ? (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
                <span>{submitError}</span>
              </div>
            ) : null}

            {/* ── Election voting ─────────────────────────── */}
            {isElection ? (
              <>
                {!hasContent ? (
                  <div className="rounded-lg border border-stone-200/80 bg-white px-5 py-10 text-center dark:border-stone-800 dark:bg-stone-900">
                    <p className="text-[13px] text-stone-400 dark:text-stone-500">
                      This election has no positions yet.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {positions.map((p) => (
                      <div key={p.id} data-field-id={p.id}>
                        <PositionVoter
                          position={p}
                          value={answers[p.id]}
                          error={errors[p.id]}
                          onChange={handleChange}
                          allowAbstain={!!form.settings?.allowAbstain}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-8 hidden flex-col items-center gap-1.5 pb-2 text-center lg:flex">
                  <XamutIcon className="h-6 w-6" />
                  <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Powered by Xamut
                  </p>
                </div>
              </>
            ) : (
              <>
                {/* ── Regular fields ──────────────────────── */}
                <div className="overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  {!hasContent ? (
                    <div className="px-5 py-10 text-center">
                      <p className="text-[13px] text-stone-400 dark:text-stone-500">
                        This form has no fields yet.
                      </p>
                    </div>
                  ) : (
                    visibleFields.map((f, i) => {
                      const isSection = f.type === "section";
                      return (
                        <div
                          key={f.id}
                          data-field-id={f.id}
                          className={
                            i > 0
                              ? "border-t border-stone-100 dark:border-stone-800/60"
                              : ""
                          }
                        >
                          {isSection ? (
                            <div className="bg-stone-50/70 px-5 py-4 dark:bg-stone-900/50 sm:px-6 sm:py-5">
                              <FieldRenderer
                                field={f}
                                value={answers[f.id]}
                                error={errors[f.id]}
                                onChange={handleChange}
                                slug={slug}
                                participantToken={participantToken}
                                onUploadingChange={handleUploadingChange}
                              />
                            </div>
                          ) : (
                            <div className="px-4 py-5 sm:px-6">
                              <FieldRenderer
                                field={f}
                                value={answers[f.id]}
                                error={errors[f.id]}
                                onChange={handleChange}
                                slug={slug}
                                participantToken={participantToken}
                                onUploadingChange={handleUploadingChange}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-8 hidden flex-col items-center gap-1.5 pb-2 text-center lg:flex">
                  <XamutIcon className="h-6 w-6" />
                  <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Powered by Xamut
                  </p>
                </div>
              </>
            )}
          </form>

          {/* Desktop sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-[80px] space-y-3">
              <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    Progress
                  </p>
                  <p className="text-[13px] font-semibold text-teal-600 dark:text-teal-400">
                    {progress}%
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all duration-300 dark:bg-teal-400"
                    style={{ width: `${Math.max(2, progress)}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-stone-100 pt-3 dark:border-stone-800/60">
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                      Answered
                    </p>
                    <p className="mt-0.5 text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                      {answeredItems}
                      <span className="text-[11px] font-normal text-stone-400 dark:text-stone-500">
                        /{totalItems}
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                      Required
                    </p>
                    <p
                      className={`mt-0.5 text-[14px] font-semibold ${
                        requiredLeft > 0
                          ? "text-stone-800 dark:text-stone-100"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {requiredLeft > 0 ? `${requiredLeft} left` : "Done"}
                    </p>
                  </div>
                </div>

                {draftStatus !== "idle" ? (
                  <div className="mt-3 flex items-center gap-1.5 border-t border-stone-100 pt-3 text-[10.5px] dark:border-stone-800/60">
                    {draftStatus === "saving" ? (
                      <>
                        <span className="text-stone-400 dark:text-stone-500">
                          {I.spinner("h-3 w-3")}
                        </span>
                        <span className="text-stone-400 dark:text-stone-500">
                          Saving draft…
                        </span>
                      </>
                    ) : draftStatus === "saved" ? (
                      <>
                        <span className="text-emerald-500 dark:text-emerald-400">
                          {I.check("h-3 w-3")}
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Draft saved
                        </span>
                      </>
                    ) : (
                      <span className="text-red-500 dark:text-red-400">
                        Draft save failed
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <button
                  type="submit"
                  form={FORM_ID}
                  disabled={submitting || anyUploading}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {submitting ? (
                    <>
                      {I.spinner("h-3.5 w-3.5")}
                      Submitting…
                    </>
                  ) : anyUploading ? (
                    <>
                      {I.spinner("h-3.5 w-3.5")}
                      Uploading…
                    </>
                  ) : isElection ? (
                    "Cast vote"
                  ) : (
                    "Submit form"
                  )}
                </button>
                {requiredLeft > 0 ? (
                  <p className="mt-2 text-center text-[10.5px] leading-relaxed text-stone-400 dark:text-stone-500">
                    {requiredLeft} required {isElection ? "position" : "question"}
                    {requiredLeft === 1 ? "" : "s"} left
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Note
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                  {isElection
                    ? "Your vote is final once submitted. Choose carefully."
                    : "Never submit passwords through this form. This page is served by Xamut on behalf of the form owner."}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile fixed bottom submit */}
      {hasContent && !submitted ? (
        <div
          className="fixed inset-x-0 z-30 flex justify-center border-t border-stone-200/70 bg-stone-50/95 px-3 py-2.5 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/95 lg:hidden"
          style={{
            bottom: 0,
            paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)",
          }}
        >
          <button
            type="submit"
            form={FORM_ID}
            disabled={submitting || anyUploading}
            className="w-full max-w-md rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                {I.spinner("h-3.5 w-3.5")}
                Submitting…
              </span>
            ) : anyUploading ? (
              <span className="inline-flex items-center gap-2">
                {I.spinner("h-3.5 w-3.5")}
                Uploading…
              </span>
            ) : isElection ? (
              "Cast vote"
            ) : (
              "Submit"
            )}
          </button>
        </div>
      ) : null}

      {showJump ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 z-30 flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500 shadow-sm transition-all hover:-translate-y-0.5 hover:text-teal-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:text-teal-400 lg:hidden"
          style={{ bottom: "max(env(safe-area-inset-bottom), 5rem)" }}
          aria-label="Scroll to top"
        >
          {I.arrowUp("h-4 w-4")}
        </button>
      ) : null}

      {/* Login prompt — one-time, for public forms only, when user is anonymous */}
      <LoginPromptModal
        open={showLoginPrompt}
        onClose={() => {
          setShowLoginPrompt(false);
          setPromptDismissed(true);
        }}
        onContinue={() => {
          setShowLoginPrompt(false);
          setPromptDismissed(true);
        }}
      />
    </div>
  );
};

export default PublicForm;