// pages/PublicForm.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  useGetPublicFormQuery,
  useParticipantLoginMutation,
  useSubmitResponseMutation,
} from "../features/formApiSlice";
import { useDocumentMeta } from "../hooks/useDocumentMeta";

// ─────────────────────────────────────────────────────────────
// Token storage helpers
// ─────────────────────────────────────────────────────────────
const tokenKey = (slug) => `participant_token_${slug}`;

const readToken = (slug) => {
  try {
    return sessionStorage.getItem(tokenKey(slug)) || null;
  } catch {
    return null;
  }
};

const writeToken = (slug, token) => {
  try {
    if (token) sessionStorage.setItem(tokenKey(slug), token);
    else sessionStorage.removeItem(tokenKey(slug));
  } catch {
    /* noop */
  }
};

// ─────────────────────────────────────────────────────────────
// Brand
// ─────────────────────────────────────────────────────────────
const XamutMark = ({ className = "h-9 w-9" }) => (
  <div
    className={`${className} flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-400 via-teal-500 to-teal-600 shadow-sm shadow-teal-500/30`}
  >
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-white">
      <path
        fill="currentColor"
        d="M6 5h3.2L12 9.3 14.8 5H18l-4.5 6.4L18.5 19H15.3L12 14.2 8.7 19H5.5L10 12.2 6 5Z"
      />
    </svg>
  </div>
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
};

// ─────────────────────────────────────────────────────────────
// Rating input
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
// Linear scale input
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
// Field renderer
// ─────────────────────────────────────────────────────────────
const FieldRenderer = ({ field, value, error, onChange }) => {
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
  const valueStr = value ?? "";
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

        {field.type === "file" ? (
          <input
            type="url"
            inputMode="url"
            value={valueStr}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste a link to your file (Drive, Dropbox, etc.)"
            className={inputClass}
          />
        ) : null}

        {/* Radio */}
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

        {/* Checkbox / multi_select */}
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

        {/* Dropdown */}
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

        {/* Yes / No */}
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

        {/* Rating */}
        {field.type === "rating" ? (
          <RatingInput
            value={Number(value) || 0}
            min={field.validation?.min ?? 1}
            max={field.validation?.max ?? 5}
            onChange={(n) => setValue(n)}
          />
        ) : null}

        {/* Linear scale */}
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
// Login screen (private forms)
// ─────────────────────────────────────────────────────────────
const ParticipantLogin = ({ slug, onSuccess, formTitle }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const [login, { isLoading }] = useParticipantLoginMutation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
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
  };

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="mb-6 flex justify-center">
          <XamutMark className="h-11 w-11" />
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
            Enter the email and password from your invite email.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-6"
        >
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
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-5 w-full rounded-md bg-teal-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                {I.spinner("h-3.5 w-3.5")}
                Signing in…
              </span>
            ) : (
              "Continue"
            )}
          </button>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400 dark:text-stone-500">
            This isn't a Xamut account. Use the credentials from your invite
            email. Lost them? Ask the form owner to resend.
          </p>
        </form>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Submitted screen
// ─────────────────────────────────────────────────────────────
const SubmittedScreen = ({ form, result }) => {
  const showScore =
    result?.score && (form?.settings?.showScoreImmediately || result.score);

  useEffect(() => {
    if (result?.successRedirectUrl) {
      const t = setTimeout(() => {
        window.location.href = result.successRedirectUrl;
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [result?.successRedirectUrl]);

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="rounded-lg border border-stone-200/80 bg-white p-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900 sm:p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm shadow-emerald-500/25">
            <span className="text-white">{I.check("h-6 w-6")}</span>
          </div>

          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[22px]">
            All done
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">
            {result?.confirmationMessage ||
              form?.settings?.confirmationMessage ||
              "Thanks, your response has been recorded."}
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

          {result?.successRedirectUrl ? (
            <p className="mt-5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Redirecting…
            </p>
          ) : null}

          <div className="mt-6 flex justify-center">
            <XamutMark className="h-7 w-7" />
          </div>
          <p className="mt-2 text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Made with Xamut
          </p>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Fatal error screen
// ─────────────────────────────────────────────────────────────
const FatalScreen = ({ title, message, status }) => {
  const isClosed = status === 410;
  const isMissing = status === 404;

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <XamutMark className="h-11 w-11" />
        <h1 className="mt-5 text-[19px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          {title ||
            (isClosed
              ? "This form isn't accepting responses"
              : isMissing
              ? "Form not found"
              : "Something went wrong")}
        </h1>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
          {message ||
            (isClosed
              ? "The owner closed it or the deadline has passed."
              : isMissing
              ? "The link may be wrong or the form was deleted."
              : "Please try again in a moment.")}
        </p>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Loading screen
// ─────────────────────────────────────────────────────────────
const LoadingScreen = ({ label = "Loading form…" }) => (
  <div className="flex min-h-dvh items-center justify-center bg-stone-50 dark:bg-stone-950">
    <div className="flex flex-col items-center gap-3">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
      <p className="text-[12px] text-stone-400 dark:text-stone-500">{label}</p>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const FORM_ID = "public-form";

const PublicForm = () => {
  const { slug } = useParams();

  const [participantToken, setParticipantToken] = useState(() =>
    readToken(slug)
  );
  const [participantInfo, setParticipantInfo] = useState(null);
  const [needLogin, setNeedLogin] = useState(false);

  const {
    data: formData,
    isLoading,
    error,
    refetch,
  } = useGetPublicFormQuery({ slug, participantToken }, { skip: !slug });

  const [submit, { isLoading: submitting }] = useSubmitResponseMutation();

  const form = formData?.form;

  // Dynamic tab title + description for this form page.
  // Runs before any early return, no-ops until form data loads.
  useDocumentMeta({
    title: form?.title ? `${form.title} — Xamut` : undefined,
    description: form?.description || undefined,
  });

  useEffect(() => {
    if (error?.status === 401) {
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

  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [startedAt] = useState(() => new Date().toISOString());
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowJump(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const validate = () => {
    if (!form) return true;
    const errs = {};
    for (const f of form.fields) {
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

      if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) {
        errs[f.id] = "Enter a valid email.";
      }
      if (f.type === "url" || f.type === "file") {
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
      setSubmitted(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const msg =
        err?.data?.message || err?.message || "Couldn't submit. Try again.";
      setSubmitError(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // ── Render branches ───────────────────────────────────────
  if (isLoading && !form) return <LoadingScreen />;

  if (needLogin && form?.visibility === "private") {
    return (
      <ParticipantLogin
        slug={slug}
        formTitle={form?.title}
        onSuccess={(token, participant) => {
          setParticipantToken(token);
          setParticipantInfo(participant);
          setNeedLogin(false);
        }}
      />
    );
  }

  if (needLogin && !form) {
    return (
      <ParticipantLogin
        slug={slug}
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
  if (submitted) return <SubmittedScreen form={form} result={submitted} />;

  if (form.visibility === "private" && !participantToken) {
    return (
      <ParticipantLogin
        slug={slug}
        formTitle={form?.title}
        onSuccess={(token, participant) => {
          setParticipantToken(token);
          setParticipantInfo(participant);
          setNeedLogin(false);
        }}
      />
    );
  }

  const visibleFields = form.fields || [];

  const requiredFields = visibleFields.filter(
    (f) => f.type !== "section" && f.required
  );
  const answeredRequired = requiredFields.filter((f) => {
    const v = answers[f.id];
    return !(
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    );
  });
  const totalFields = visibleFields.filter((f) => f.type !== "section");
  const answeredAll = totalFields.filter((f) => {
    const v = answers[f.id];
    return !(
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    );
  });
  const progress = totalFields.length
    ? Math.round((answeredAll.length / totalFields.length) * 100)
    : 0;
  const requiredLeft = requiredFields.length - answeredRequired.length;

  const showProgress = form.settings?.showProgressBar !== false;
  const hasFields = visibleFields.length > 0;
  const showMobileProgress = showProgress && totalFields.length > 0;

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      {/* Sticky header — mobile has a real progress bar block at its bottom edge */}
      <header
        className="sticky top-0 z-30 bg-stone-50/90 backdrop-blur-xl dark:bg-stone-950/90"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-2.5 px-3 sm:h-14 sm:px-6">
          <XamutMark className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {form.title}
            </p>
            <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
              {showProgress ? `${progress}% complete` : "Form in progress"}
              {requiredLeft > 0
                ? ` · ${requiredLeft} required left`
                : requiredFields.length > 0
                ? " · ready to submit"
                : ""}
            </p>
          </div>
          {form.visibility === "private" ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              {I.lock("h-3 w-3")}
              Private
            </span>
          ) : null}
        </div>

        {/* Mobile progress bar — real block element, so no stacking/clipping issues. */}
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
        {/* Title hero */}
        <div className="mb-5 sm:mb-6">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100 sm:text-[28px]">
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
        </div>

        {/* Two-column layout on desktop */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px] lg:gap-6">
          {/* Form — the ONLY form on the page */}
          <form id={FORM_ID} onSubmit={handleSubmit} className="min-w-0">
            {submitError ? (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
                <span>{submitError}</span>
              </div>
            ) : null}

            {/* Fields sheet */}
            <div className="overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
              {!hasFields ? (
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
                          />
                        </div>
                      ) : (
                        <div className="px-4 py-5 sm:px-6">
                          <FieldRenderer
                            field={f}
                            value={answers[f.id]}
                            error={errors[f.id]}
                            onChange={handleChange}
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Brand footer — desktop only, in-flow */}
            <div className="mt-8 hidden flex-col items-center gap-1.5 pb-2 text-center lg:flex">
              <XamutMark className="h-6 w-6" />
              <p className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Powered by Xamut
              </p>
            </div>
          </form>

          {/* Desktop sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-[80px] space-y-3">
              {/* Progress card */}
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
                      {answeredAll.length}
                      <span className="text-[11px] font-normal text-stone-400 dark:text-stone-500">
                        /{totalFields.length}
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
              </div>

              {/* Submit card */}
              <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <button
                  type="submit"
                  form={FORM_ID}
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {submitting ? (
                    <>
                      {I.spinner("h-3.5 w-3.5")}
                      Submitting…
                    </>
                  ) : (
                    "Submit form"
                  )}
                </button>
                {requiredLeft > 0 ? (
                  <p className="mt-2 text-center text-[10.5px] leading-relaxed text-stone-400 dark:text-stone-500">
                    {requiredLeft} required question
                    {requiredLeft === 1 ? "" : "s"} left
                  </p>
                ) : null}
              </div>

              {/* Note */}
              <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Note
                </p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                  Never submit passwords through this form. This page is served
                  by Xamut on behalf of the form owner.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile fixed bottom submit — the ONLY submit on mobile */}
      {hasFields && !submitted ? (
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
            disabled={submitting}
            className="w-full max-w-md rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                {I.spinner("h-3.5 w-3.5")}
                Submitting…
              </span>
            ) : (
              "Submit"
            )}
          </button>
        </div>
      ) : null}

      {/* Scroll to top */}
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
    </div>
  );
};

export default PublicForm;