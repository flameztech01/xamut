// pages/Signin.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useDispatch } from "react-redux";
import {
  useLoginMutation,
  useGoogleAuthMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
} from "../features/userApiSlice";
import { setCredentials } from "../features/auth/authSlice";

// ─────────────────────────────────────────────────────────────
// Brand logo
// ─────────────────────────────────────────────────────────────
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
const IconEye = ({ className = "h-5 w-5" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconEyeOff = ({ className = "h-5 w-5" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 9 7a11.8 11.8 0 0 1-2.2 3.6" />
    <path d="M6.6 6.6C4 8.2 3 11 3 12c0 1.5 4 7 9 7 1.2 0 2.3-.3 3.3-.7" />
  </svg>
);

const IconAlert = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
  </svg>
);

// Only accept internal paths ("/forms/abc"). Reject anything that
// looks external, protocol-relative, or javascript: — prevents an
// open-redirect where a crafted ?next= sends a freshly-logged-in
// user off-site.
const safeNext = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  // Must start with a single "/" and not "//" (protocol-relative)
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Reject control chars and backslashes (used to bypass startWith checks)
  if (/[\x00-\x1f\\]/.test(raw)) return null;
  return raw;
};

const Signin = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();

  // Where to land after auth. Falls back to "/" if missing or unsafe.
  const nextParam = safeNext(searchParams.get("next"));
  const nextUrl = nextParam || "/";
  const signupHref = nextParam
    ? `/signup?next=${encodeURIComponent(nextParam)}`
    : "/signup";

  const [login, { isLoading }] = useLoginMutation();
  const [googleAuth, { isLoading: isGoogleLoading }] = useGoogleAuthMutation();
  const [forgotPassword, { isLoading: isSendingOtp }] = useForgotPasswordMutation();
  const [resetPassword, { isLoading: isResetting }] = useResetPasswordMutation();

  // "signin" | "forgot" | "reset"
  const [step, setStep] = useState("signin");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // ─── Signin form ─────────────────────────────────────────────
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!form.email.trim() || !form.password) {
      setError("Please enter your email and password.");
      return;
    }

    try {
      const res = await login({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      }).unwrap();
      dispatch(setCredentials(res));
      navigate(nextUrl, { replace: true });
    } catch (err) {
      setError(err?.data?.message || "Invalid email or password.");
    }
  };

  const handleGoogle = async () => {
    setError("");
    try {
      // TODO: once the Google popup is wired, pass nextUrl through the
      // OAuth state param so the callback can navigate back here.
      setError(
        "Google sign-in needs to be connected. Add your GOOGLE_CLIENT_ID and wire the popup."
      );
    } catch (err) {
      setError(err?.data?.message || "Google sign-in failed.");
    }
  };

  // ─── Forgot password ─────────────────────────────────────────
  const [forgotEmail, setForgotEmail] = useState("");

  const handleForgot = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!forgotEmail.trim()) {
      setError("Please enter your email.");
      return;
    }

    try {
      await forgotPassword({ email: forgotEmail.trim().toLowerCase() }).unwrap();
      setStep("reset");
    } catch (err) {
      setError(err?.data?.message || "Could not send reset code.");
    }
  };

  // ─── Reset ───────────────────────────────────────────────────
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputsRef = useRef([]);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (step === "reset") {
      inputsRef.current[0]?.focus();
      setCooldown(30);
    }
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleOtpChange = (index, value) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (error) setError("");
    if (digit && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && index > 0) inputsRef.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, 6)
      .split("");
    if (!pasted.length) return;
    const next = ["", "", "", "", "", ""];
    pasted.forEach((d, i) => (next[i] = d));
    setOtp(next);
    inputsRef.current[Math.min(pasted.length, 5)]?.focus();
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    try {
      await resetPassword({
        email: forgotEmail.trim().toLowerCase(),
        otp: code,
        newPassword,
      }).unwrap();

      setOtp(["", "", "", "", "", ""]);
      setNewPassword("");
      setForm((prev) => ({ ...prev, email: forgotEmail.trim().toLowerCase() }));
      setStep("signin");
      setInfo("Password reset. You can sign in now.");
    } catch (err) {
      setError(err?.data?.message || "Invalid or expired code.");
      setOtp(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    }
  };

  const handleResendReset = async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      await forgotPassword({ email: forgotEmail.trim().toLowerCase() }).unwrap();
      setCooldown(30);
      setOtp(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
      setInfo("New code sent.");
    } catch (err) {
      setError(err?.data?.message || "Could not resend code.");
    }
  };

  const goToForgot = () => {
    setStep("forgot");
    setError("");
    setInfo("");
    setForgotEmail(form.email || "");
  };

  const goBackToSignin = () => {
    setStep("signin");
    setError("");
    setInfo("");
    setOtp(["", "", "", "", "", ""]);
    setNewPassword("");
  };

  const GLASS_COPY = {
    signin: {
      title: "Welcome back. Pick up right where you left off.",
      chips: ["AI Chat", "Coding", "Assignments", "Docs", "Print"],
    },
    forgot: {
      title: "Forgot your password? We'll email you a 6-digit code.",
      chips: ["Reset", "Secure", "Fast"],
    },
    reset: {
      title: "Almost there. Enter the code and set a new password.",
      chips: ["Verify", "New password", "Done"],
    },
  }[step];

  const inputClass =
    "w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/60";

  return (
    <div className="h-dvh w-full overflow-hidden bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100 md:grid md:grid-cols-[45%_55%]">
      {/* ─── Image side (desktop only) ───────────────────── */}
      <div className="relative hidden md:block">
        <img
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80"
          alt="Students learning together"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/25" />

        <Link
          to="/"
          className="absolute left-8 top-8 flex items-center [&_img]:brightness-0 [&_img]:invert"
        >
          <XamutLogo className="h-9 w-auto" />
        </Link>

        <div className="absolute inset-x-8 bottom-8">
          <div className="rounded-xl border border-white/20 bg-white/10 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <p className="text-[17px] font-medium leading-snug text-white">
              {GLASS_COPY.title}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {GLASS_COPY.chips.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-[11.5px] font-medium text-white/90 backdrop-blur"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Content side ─────────────────────────────────── */}
      <div className="relative h-full w-full overflow-y-auto scrollbar-thin bg-stone-50 dark:bg-stone-950">
        <div className="pointer-events-none absolute -top-24 -right-24 hidden h-80 w-80 rounded-full bg-teal-300/30 blur-3xl dark:bg-teal-500/10 md:block" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 hidden h-80 w-80 rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-500/10 md:block" />

        <div className="relative flex min-h-full items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <Link to="/" className="mb-7 flex items-center md:hidden">
              <XamutLogo className="h-9 w-auto" />
            </Link>

            <div className="mb-7">
              {step === "signin" ? (
                <>
                  <h1 className="text-[26px] font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
                    Welcome back
                  </h1>
                  <p className="mt-2 text-[13.5px] text-stone-500 dark:text-stone-400">
                    {nextParam
                      ? "Sign in to continue where you left off."
                      : "Sign in to continue to your workspace."}
                  </p>
                </>
              ) : null}
              {step === "forgot" ? (
                <>
                  <h1 className="text-[26px] font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
                    Forgot password?
                  </h1>
                  <p className="mt-2 text-[13.5px] text-stone-500 dark:text-stone-400">
                    Enter your email and we'll send a reset code.
                  </p>
                </>
              ) : null}
              {step === "reset" ? (
                <>
                  <h1 className="text-[26px] font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
                    Set a new password
                  </h1>
                  <p className="mt-2 text-[13.5px] text-stone-500 dark:text-stone-400">
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-stone-800 dark:text-stone-200">
                      {forgotEmail}
                    </span>
                  </p>
                </>
              ) : null}
            </div>

            {error ? (
              <div className="mb-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <IconAlert className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {info ? (
              <div className="mb-4 flex items-center gap-2 text-[12.5px] text-teal-700 dark:text-teal-300">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500 dark:bg-teal-400" />
                <span>{info}</span>
              </div>
            ) : null}

            {/* ─── Signin step ───────────────────────────── */}
            {step === "signin" ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={goToForgot}
                      className="text-[11.5px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="Your password"
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {isLoading ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-stone-200 dark:border-stone-800" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-stone-50 px-3 text-[10.5px] font-medium uppercase tracking-wider text-stone-400 dark:bg-stone-950 dark:text-stone-500">
                      or
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isGoogleLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-md border border-stone-200 bg-white px-6 py-3 text-[13.5px] font-semibold text-stone-700 shadow-sm transition-all hover:border-stone-300 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.26 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.45.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.42 3.47 1.18 4.95l3.66-2.84Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
                    />
                  </svg>
                  {isGoogleLoading ? "Connecting…" : "Continue with Google"}
                </button>

                <p className="mt-6 text-center text-[13px] text-stone-500 dark:text-stone-400">
                  Don't have an account?{" "}
                  <Link
                    to={signupHref}
                    className="font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
                  >
                    Create one
                  </Link>
                </p>

                <p className="mt-6 text-center text-[11px] text-stone-400 dark:text-stone-500">
                  By continuing, you agree to our Terms &amp; Privacy Policy.
                </p>
              </form>
            ) : null}

            {/* ─── Forgot step ───────────────────────────── */}
            {step === "forgot" ? (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
                  >
                    Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    value={forgotEmail}
                    onChange={(e) => {
                      setForgotEmail(e.target.value);
                      if (error) setError("");
                    }}
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSendingOtp}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {isSendingOtp ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Sending code…
                    </>
                  ) : (
                    "Send reset code"
                  )}
                </button>

                <div className="flex items-center justify-between text-[13px]">
                  <button
                    type="button"
                    onClick={goBackToSignin}
                    className="font-medium text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                  >
                    ← Back to sign in
                  </button>
                </div>

                <p className="text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                  We'll never share your email. If an account exists, a code
                  will be sent.
                </p>
              </form>
            ) : null}

            {/* ─── Reset step ────────────────────────────── */}
            {step === "reset" ? (
              <form onSubmit={handleReset} className="space-y-6">
                <div>
                  <div
                    className="flex items-center justify-center gap-2"
                    onPaste={handleOtpPaste}
                  >
                    {otp.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => (inputsRef.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className={`h-12 w-10 rounded-md border bg-white text-center text-[18px] font-semibold text-stone-900 outline-none transition-all focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-teal-500/60 sm:h-14 sm:w-12 sm:text-[20px] ${
                          digit
                            ? "border-teal-300 bg-teal-50/40 dark:border-teal-500/40 dark:bg-teal-500/5"
                            : "border-stone-200 dark:border-stone-700"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-4 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                    {cooldown > 0 ? (
                      <>
                        Didn't get it? Resend in{" "}
                        <span className="font-semibold text-stone-500 dark:text-stone-400">
                          {cooldown}s
                        </span>
                      </>
                    ) : (
                      <>
                        Didn't get it?{" "}
                        <button
                          type="button"
                          onClick={handleResendReset}
                          disabled={isSendingOtp}
                          className="font-semibold text-teal-600 hover:text-teal-700 disabled:opacity-50 dark:text-teal-400 dark:hover:text-teal-300"
                        >
                          {isSendingOtp ? "Sending…" : "Resend code"}
                        </button>
                      </>
                    )}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="new-password"
                    className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
                  >
                    New password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (error) setError("");
                      }}
                      placeholder="At least 8 characters"
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((s) => !s)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      aria-label={
                        showNewPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showNewPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isResetting}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {isResetting ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Resetting…
                    </>
                  ) : (
                    "Reset password"
                  )}
                </button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={goBackToSignin}
                    className="text-[12.5px] font-medium text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                  >
                    ← Back to sign in
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signin;