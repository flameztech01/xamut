// pages/Signin.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useDispatch } from "react-redux";
import {
  useLoginMutation,
  useGoogleAuthMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
} from "../features/userApiSlice";
import { setCredentials } from "../features/auth/authSlice";

const Signin = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [login, { isLoading }] = useLoginMutation();
  const [googleAuth, { isLoading: isGoogleLoading }] = useGoogleAuthMutation();
  const [forgotPassword, { isLoading: isSendingOtp }] =
    useForgotPasswordMutation();
  const [resetPassword, { isLoading: isResetting }] = useResetPasswordMutation();

  // "signin" | "forgot" | "reset"
  const [step, setStep] = useState("signin");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // ─── Signin form ─────────────────────────────────────────────────
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
      navigate("/");
    } catch (err) {
      setError(err?.data?.message || "Invalid email or password.");
    }
  };

  // ─── Google (still a placeholder) ────────────────────────────────
  const handleGoogle = async () => {
    setError("");
    try {
      setError(
        "Google sign-in needs to be connected. Add your GOOGLE_CLIENT_ID and wire the popup."
      );
    } catch (err) {
      setError(err?.data?.message || "Google sign-in failed.");
    }
  };

  // ─── Forgot password: send OTP ───────────────────────────────────
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
      await forgotPassword({
        email: forgotEmail.trim().toLowerCase(),
      }).unwrap();
      // Controller always returns a 200 with a generic message
      setInfo("If that email exists, we've sent a 6-digit code.");
      setStep("reset");
    } catch (err) {
      setError(err?.data?.message || "Could not send reset code.");
    }
  };

  // ─── Reset: OTP + new password ───────────────────────────────────
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputsRef = useRef([]);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Focus + cooldown when entering reset step
  useEffect(() => {
    if (step === "reset") {
      inputsRef.current[0]?.focus();
      setCooldown(30);
    }
  }, [step]);

  // Cooldown tick
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
    if (e.key === "ArrowRight" && index < 5)
      inputsRef.current[index + 1]?.focus();
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

      // Clean up & send them back to signin with a success note
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

  // ─── Navigate between steps ──────────────────────────────────────
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

  // ─── Per-step copy for the glass card on the image side ──────────
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
      title: "Almost there — enter the code and set a new password.",
      chips: ["Verify", "New password", "Done"],
    },
  }[step];

  return (
    <div className="h-screen w-screen overflow-hidden bg-white md:grid md:grid-cols-[45%_55%]">
      {/* ─── Image side (desktop only) ───────────────────── */}
      <div className="relative hidden md:block">
        <img
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80"
          alt="Students learning together"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/20" />

        <Link to="/" className="absolute left-8 top-8 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-lg font-bold text-white shadow-lg shadow-orange-500/40">
            X
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            Xamut
          </span>
        </Link>

        <div className="absolute inset-x-8 bottom-8">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl shadow-black/30">
            <p className="text-lg font-medium leading-snug text-white">
              {GLASS_COPY.title}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {GLASS_COPY.chips.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Content side ─────────────────────────────────── */}
      <div className="relative h-full overflow-y-auto bg-gradient-to-br from-white via-orange-50/50 to-orange-100/70">
        <div className="pointer-events-none absolute -top-24 -right-24 hidden h-80 w-80 rounded-full bg-orange-300/40 blur-3xl md:block" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 hidden h-80 w-80 rounded-full bg-orange-400/25 blur-3xl md:block" />

        <div className="relative flex min-h-full items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-md">
            {/* Mobile brand */}
            <Link to="/" className="mb-8 flex items-center gap-2.5 md:hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 text-lg font-bold text-white shadow-lg shadow-orange-500/40">
                X
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">
                Xamut
              </span>
            </Link>

            {/* Heading — varies by step */}
            <div className="mb-7">
              {step === "signin" && (
                <>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Welcome back
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Sign in to continue to your workspace.
                  </p>
                </>
              )}
              {step === "forgot" && (
                <>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Forgot password?
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Enter your email and we'll send a reset code.
                  </p>
                </>
              )}
              {step === "reset" && (
                <>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Set a new password
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    Enter the code sent to{" "}
                    <span className="font-medium text-slate-800">
                      {forgotEmail}
                    </span>
                  </p>
                </>
              )}
            </div>

            {/* Error banner */}
            {error && (
              <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Info banner */}
            {info && (
              <div className="mb-5 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
                {info}
              </div>
            )}

            {/* ─── Signin step ───────────────────────────── */}
            {step === "signin" && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
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
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={goToForgot}
                      className="text-xs font-semibold text-orange-600 hover:text-orange-700"
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:text-slate-700"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-5 w-5"
                        >
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 9 7a11.8 11.8 0 0 1-2.2 3.6" />
                          <path d="M6.6 6.6C4 8.2 3 11 3 12c0 1.5 4 7 9 7 1.2 0 2.3-.3 3.3-.7" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-5 w-5"
                        >
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-2 w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Signing in…
                    </span>
                  ) : (
                    "Sign in"
                  )}
                </button>

                {/* Divider */}
                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-gradient-to-br from-white via-orange-50/50 to-orange-100/70 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
                      or
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={isGoogleLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
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

                <p className="mt-6 text-center text-sm text-slate-600">
                  Don't have an account?{" "}
                  <Link
                    to="/signup"
                    className="font-semibold text-orange-600 hover:text-orange-700"
                  >
                    Create one
                  </Link>
                </p>

                <p className="mt-6 text-center text-xs text-slate-400">
                  By continuing, you agree to our Terms &amp; Privacy Policy.
                </p>
              </form>
            )}

            {/* ─── Forgot step ───────────────────────────── */}
            {step === "forgot" && (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label
                    htmlFor="forgot-email"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
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
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSendingOtp}
                  className="w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSendingOtp ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Sending code…
                    </span>
                  ) : (
                    "Send reset code"
                  )}
                </button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={goBackToSignin}
                    className="font-medium text-slate-500 hover:text-slate-700"
                  >
                    ← Back to sign in
                  </button>
                </div>

                <p className="text-center text-xs text-slate-400">
                  We'll never share your email. If an account exists, a code
                  will be sent.
                </p>
              </form>
            )}

            {/* ─── Reset step ────────────────────────────── */}
            {step === "reset" && (
              <form onSubmit={handleReset} className="space-y-6">
                {/* 6 boxes */}
                <div
                  className="flex items-center justify-between gap-2 sm:gap-3"
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
                      className="h-14 w-full max-w-[3.25rem] rounded-xl border border-slate-200 bg-white text-center text-xl font-semibold text-slate-900 outline-none transition-all focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                    />
                  ))}
                </div>

                {/* New password */}
                <div>
                  <label
                    htmlFor="new-password"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
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
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:text-slate-700"
                      aria-label={
                        showNewPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showNewPassword ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-5 w-5"
                        >
                          <path d="M3 3l18 18" />
                          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                          <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 9 7a11.8 11.8 0 0 1-2.2 3.6" />
                          <path d="M6.6 6.6C4 8.2 3 11 3 12c0 1.5 4 7 9 7 1.2 0 2.3-.3 3.3-.7" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-5 w-5"
                        >
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isResetting}
                  className="w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isResetting ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Resetting…
                    </span>
                  ) : (
                    "Reset password"
                  )}
                </button>

                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={goBackToSignin}
                    className="font-medium text-slate-500 hover:text-slate-700"
                  >
                    ← Back to sign in
                  </button>

                  <button
                    type="button"
                    onClick={handleResendReset}
                    disabled={cooldown > 0 || isSendingOtp}
                    className="font-semibold text-orange-600 transition-colors hover:text-orange-700 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {isSendingOtp
                      ? "Sending…"
                      : cooldown > 0
                        ? `Resend in ${cooldown}s`
                        : "Resend code"}
                  </button>
                </div>

                <p className="text-center text-xs text-slate-400">
                  Didn't get it? Check spam, or use the resend button.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signin;