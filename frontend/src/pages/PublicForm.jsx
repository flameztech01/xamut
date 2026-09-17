// pages/PublicForm.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  useGetPublicFormQuery,
  useParticipantLoginMutation,
  useSubmitResponseMutation,
} from "../features/formApiSlice";

// ─────────────────────────────────────────────────────────────
// Token storage helpers
//
// Participant tokens are scoped per form and only need to live for
// the length of the browsing session. sessionStorage is fine.
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
};

// ─────────────────────────────────────────────────────────────
// Field renderer
// ─────────────────────────────────────────────────────────────
const FieldRenderer = ({ field, value, error, onChange }) => {
  const hasError = !!error;
  const baseInput =
    "w-full rounded-xl border bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:ring-4";
  const inputClass = `${baseInput} ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-500/10"
      : "border-stone-200 focus:border-orange-400 focus:ring-orange-500/10"
  }`;

  // ── Section header ────────────────────────────────────────
  if (field.type === "section") {
    return (
      <div className="border-b border-stone-200 pb-2 pt-4 first:pt-0">
        <h2 className="text-[16px] font-semibold tracking-tight text-stone-900">
          {field.label}
        </h2>
        {field.description ? (
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
            {field.description}
          </p>
        ) : null}
      </div>
    );
  }

  const setValue = (v) => onChange(field.id, v);

  // ── Choice value helpers ──────────────────────────────────
  const valueStr = value ?? "";
  const arrayValue = Array.isArray(value) ? value : [];

  return (
    <div>
      {/* Label */}
      <label className="mb-1.5 block">
        <span className="text-[13.5px] font-medium leading-snug text-stone-800">
          {field.label}
          {field.required ? (
            <span className="ml-1 text-orange-500">*</span>
          ) : null}
        </span>
        {field.description ? (
          <span className="mt-0.5 block text-[12px] leading-snug text-stone-500">
            {field.description}
          </span>
        ) : null}
      </label>

      {/* Input by type */}
      <div className="mt-2">
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
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    checked
                      ? "border-orange-300 bg-orange-50/70 ring-2 ring-orange-500/10"
                      : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      checked
                        ? "border-orange-500"
                        : "border-stone-300"
                    }`}
                  >
                    {checked ? (
                      <span className="h-2 w-2 rounded-full bg-orange-500" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-stone-800">
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
                  className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    checked
                      ? "border-orange-300 bg-orange-50/70 ring-2 ring-orange-500/10"
                      : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      checked
                        ? "border-orange-500 bg-orange-500"
                        : "border-stone-300"
                    }`}
                  >
                    {checked ? (
                      <span className="text-white">{I.check("h-2.5 w-2.5")}</span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-stone-800">
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
                  className={`flex-1 rounded-xl border px-4 py-2.5 text-[13.5px] font-semibold transition-all ${
                    checked
                      ? "border-orange-300 bg-orange-50 text-orange-700 ring-2 ring-orange-500/10"
                      : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
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

      {/* Error message */}
      {hasError ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-red-600">
          {I.alert("h-3.5 w-3.5 shrink-0")}
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Rating input
// ─────────────────────────────────────────────────────────────
const RatingInput = ({ value, min, max, onChange }) => {
  const items = [];
  for (let i = min; i <= max; i++) items.push(i);

  return (
    <div className="flex items-center gap-1.5">
      {items.map((n) => {
        const active = value >= n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-all active:scale-95 ${
              active
                ? "border-amber-300 bg-amber-50 text-amber-500"
                : "border-stone-200 bg-white text-stone-300 hover:border-stone-300"
            }`}
            aria-label={`Rate ${n}`}
          >
            {active
              ? I.star("h-5 w-5")
              : I.starOutline("h-5 w-5")}
          </button>
        );
      })}
      {value ? (
        <button
          type="button"
          onClick={() => onChange(0)}
          className="ml-1 text-[11.5px] font-semibold text-stone-400 hover:text-stone-700"
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
    <div className="scrollbar-none -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-1">
      {items.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`flex h-11 shrink-0 items-center justify-center rounded-xl border font-semibold transition-all active:scale-95 ${
              compact ? "w-11 text-[12.5px]" : "flex-1 text-[13px]"
            } ${
              active
                ? "border-orange-300 bg-orange-500 text-white shadow-sm shadow-orange-500/30"
                : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50"
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
// Login screen (private forms only)
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
    <div className="flex min-h-dvh flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="mb-6 flex justify-center">
          <XamutMark className="h-12 w-12 rounded-2xl" />
        </div>

        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-stone-500">
            {I.lock("h-3 w-3")}
            Private form
          </span>
          <h1 className="mt-3 text-[20px] font-semibold tracking-tight text-stone-900 sm:text-[24px]">
            {formTitle || "Sign in to continue"}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
            Enter the email and password from your invite email.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-lg shadow-stone-900/[0.03] sm:p-6"
        >
          {error ? (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
              <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
              <span>{error}</span>
            </div>
          ) : null}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="participant-email"
                className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-stone-500"
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
                className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
              />
            </div>

            <div>
              <label
                htmlFor="participant-password"
                className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-stone-500"
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
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 pr-11 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
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
            className="mt-5 w-full rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-5 py-3 text-[13px] font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:shadow-xl hover:shadow-orange-500/35 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Signing in…
              </span>
            ) : (
              "Continue"
            )}
          </button>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-stone-400">
            This isn't a Xamut account. Use the credentials from your invite email.
            Lost them? Ask the form owner to resend.
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
    <div className="flex min-h-dvh flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-8 sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <div className="rounded-3xl border border-stone-200/80 bg-white p-6 text-center shadow-lg shadow-stone-900/[0.03] sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/25">
            <span className="text-white">{I.check("h-7 w-7")}</span>
          </div>

          <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-stone-900 sm:text-[24px]">
            All done
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-stone-500">
            {result?.confirmationMessage ||
              form?.settings?.confirmationMessage ||
              "Thanks, your response has been recorded."}
          </p>

          {showScore ? (
            <div className="mt-6 rounded-2xl border border-purple-200/70 bg-purple-50/50 p-4">
              <div className="flex items-center justify-center gap-2 text-purple-600">
                {I.trophy("h-4 w-4")}
                <p className="text-[11px] font-semibold uppercase tracking-wider">
                  Your score
                </p>
              </div>
              <p className="mt-2 text-[32px] font-bold leading-none tracking-tight text-purple-700">
                {result.score.percentage}%
              </p>
              <p className="mt-1.5 text-[12px] text-purple-700/80">
                {result.score.totalScore} out of {result.score.maxScore} points
              </p>
              {result.score.passed !== null &&
              result.score.passed !== undefined ? (
                <p
                  className={`mt-2 inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    result.score.passed
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  {result.score.passed ? "Passed" : "Failed"}
                </p>
              ) : null}
            </div>
          ) : null}

          {result?.successRedirectUrl ? (
            <p className="mt-5 text-[11.5px] text-stone-400">
              Redirecting…
            </p>
          ) : null}

          <div className="mt-6 flex justify-center">
            <XamutMark className="h-8 w-8 rounded-xl" />
          </div>
          <p className="mt-2 text-[10.5px] uppercase tracking-wider text-stone-400">
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
    <div className="flex min-h-dvh flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      <div
        className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-6"
        style={{ paddingTop: "max(env(safe-area-inset-top), 2rem)" }}
      >
        <XamutMark className="h-11 w-11 rounded-2xl" />
        <h1 className="mt-5 text-[19px] font-semibold tracking-tight text-stone-900">
          {title ||
            (isClosed
              ? "This form isn't accepting responses"
              : isMissing
              ? "Form not found"
              : "Something went wrong")}
        </h1>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-stone-500">
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
// Main page
// ─────────────────────────────────────────────────────────────
const PublicForm = () => {
  const { slug } = useParams();

  const [participantToken, setParticipantToken] = useState(() =>
    readToken(slug)
  );
  const [participantInfo, setParticipantInfo] = useState(null);
  const [needLogin, setNeedLogin] = useState(false);

  // form data
  const {
    data: formData,
    isLoading,
    error,
    refetch,
  } = useGetPublicFormQuery(
    { slug, participantToken },
    { skip: !slug }
  );

  const [submit, { isLoading: submitting }] = useSubmitResponseMutation();

  // If the query comes back 401 (private form, no token), flip to login
  useEffect(() => {
    if (error?.status === 401) {
      setNeedLogin(true);
      writeToken(slug, null);
      setParticipantToken(null);
    }
  }, [error, slug]);

  // If we were given a token at mount and got data back, we're logged in
  useEffect(() => {
    if (formData?.participant) {
      setParticipantInfo(formData.participant);
      setNeedLogin(false);
    }
  }, [formData]);

  const form = formData?.form;

  // answers keyed by fieldId
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [startedAt] = useState(() => new Date().toISOString());
  const [showJump, setShowJump] = useState(false);

  // Track scroll to show "scroll to top" on long forms
  useEffect(() => {
    const onScroll = () => {
      setShowJump(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Required + basic type validation. Server does the authoritative check.
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
      // Scroll to the first error
      const firstErrorId = Object.keys(errors)[0];
      if (firstErrorId) {
        const el = document.querySelector(
          `[data-field-id="${firstErrorId}"]`
        );
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
  if (isLoading && !form) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f5f0]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
          <p className="text-[12px] text-stone-400">Loading form…</p>
        </div>
      </div>
    );
  }

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

  if (error && !form) {
    return <FatalScreen status={error?.status} />;
  }

  if (!form) {
    return <FatalScreen status={404} />;
  }

  if (submitted) {
    return <SubmittedScreen form={form} result={submitted} />;
  }

  // If the form is private and we somehow got here without a token,
  // the login flow should have taken over. Safety net:
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

  // ── Visible fields (skip nothing, we render sections too) ─
  const visibleFields = form.fields || [];

  // Progress (answered required fields)
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
  const progress = requiredFields.length
    ? Math.round((answeredRequired.length / requiredFields.length) * 100)
    : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      {/* Progress bar (top of viewport when enabled) */}
      {form.settings?.showProgressBar && requiredFields.length > 0 ? (
        <div
          className="fixed inset-x-0 top-0 z-40 h-1 bg-stone-200"
          style={{ top: "env(safe-area-inset-top)" }}
        >
          <div
            className="h-full bg-gradient-to-r from-orange-400 to-orange-600 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}

      {/* Header */}
      <div
        className="mx-auto w-full max-w-2xl px-3 pt-6 sm:px-6 sm:pt-8"
        style={{ paddingTop: "max(env(safe-area-inset-top), 1.5rem)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <XamutMark className="h-9 w-9 rounded-xl" />
          {form.visibility === "private" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
              {I.lock("h-3 w-3")}
              Private
            </span>
          ) : null}
        </div>

        {/* Title card */}
        <div className="overflow-hidden rounded-3xl border border-stone-200/80 bg-white shadow-lg shadow-stone-900/[0.03]">
          <div className="h-2 bg-gradient-to-r from-orange-400 via-orange-500 to-orange-600" />
          <div className="px-5 pb-5 pt-5 sm:px-7 sm:pb-7 sm:pt-6">
            <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-stone-900 sm:text-[26px]">
              {form.title}
            </h1>
            {form.description ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-stone-500">
                {form.description}
              </p>
            ) : null}
            {form.visibility === "private" && participantInfo?.email ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] text-stone-600">
                {I.check("h-3 w-3 text-emerald-600")}
                Signed in as{" "}
                <span className="font-semibold">{participantInfo.email}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Fields */}
      <form
        onSubmit={handleSubmit}
        className="mx-auto w-full max-w-2xl flex-1 px-3 pb-32 pt-3 sm:px-6 sm:pb-40 sm:pt-4"
      >
        {submitError ? (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
            <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
            <span>{submitError}</span>
          </div>
        ) : null}

        <div className="space-y-4">
          {visibleFields.map((f) => (
            <div
              key={f.id}
              data-field-id={f.id}
              className={
                f.type === "section"
                  ? ""
                  : "rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm shadow-stone-900/[0.02] sm:p-5"
              }
            >
              <FieldRenderer
                field={f}
                value={answers[f.id]}
                error={errors[f.id]}
                onChange={handleChange}
              />
            </div>
          ))}
        </div>

        {/* Submit button — in-flow at end of fields */}
        <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-center text-[11px] text-stone-400 sm:text-left">
            Never submit passwords through this form.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-6 py-3 text-[13px] font-semibold text-white shadow-lg shadow-orange-500/25 transition-all hover:shadow-xl hover:shadow-orange-500/35 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Submitting…
              </>
            ) : (
              "Submit"
            )}
          </button>
        </div>

        <div className="mt-8 flex flex-col items-center gap-1.5 pb-4 text-center">
          <XamutMark className="h-7 w-7 rounded-lg" />
          <p className="text-[10.5px] uppercase tracking-wider text-stone-400">
            Powered by Xamut
          </p>
        </div>
      </form>

      {/* Floating submit button on mobile (sticks to bottom) */}
      <div
        className="fixed inset-x-0 z-30 flex justify-center px-4 sm:hidden"
        style={{ bottom: "max(env(safe-area-inset-bottom), 1rem)" }}
      >
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full max-w-md rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-6 py-3.5 text-[13.5px] font-semibold text-white shadow-xl shadow-orange-500/35 transition-all active:scale-[0.98] disabled:opacity-70"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Submitting…
            </span>
          ) : (
            "Submit"
          )}
        </button>
      </div>

      {/* Scroll to top */}
      {showJump ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 shadow-lg shadow-stone-900/5 transition-all hover:-translate-y-0.5 hover:text-orange-600"
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