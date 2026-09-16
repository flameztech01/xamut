// pages/Signup.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useDispatch } from "react-redux";
import {
  useRegisterMutation,
  useVerifyOtpMutation,
  useResendOtpMutation,
} from "../features/userApiSlice";
import { setCredentials } from "../features/auth/authSlice";

const Signup = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [register, { isLoading: isRegistering }] = useRegisterMutation();
  const [verifyOtp, { isLoading: isVerifying }] = useVerifyOtpMutation();
  const [resendOtp, { isLoading: isResending }] = useResendOtpMutation();

  // "register" | "otp"
  const [step, setStep] = useState("register");

  // Shared error
  const [error, setError] = useState("");

  // ─── Register form state ─────────────────────────────────────────
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    isStudent: false,
    school: "",
  });
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    if (error) setError("");
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.isStudent && !form.school.trim()) {
      setError("Please tell us your school.");
      return;
    }

    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        isStudent: form.isStudent,
      };
      if (form.isStudent) payload.school = form.school.trim();

      await register(payload).unwrap();
      setForm((prev) => ({ ...prev, email: payload.email }));
      setStep("otp");
    } catch (err) {
      setError(err?.data?.message || "Something went wrong. Try again.");
    }
  };

  // ─── OTP state ───────────────────────────────────────────────────
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputsRef = useRef([]);
  const [cooldown, setCooldown] = useState(0);

  // Auto-focus first box when entering OTP step + start cooldown
  useEffect(() => {
    if (step === "otp") {
      inputsRef.current[0]?.focus();
      setCooldown(30);
    }
  }, [step]);

  // Resend cooldown tick
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
    if (e.key === "ArrowLeft" && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
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
    const lastIndex = Math.min(pasted.length, 5);
    inputsRef.current[lastIndex]?.focus();
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }

    try {
      const res = await verifyOtp({ email: form.email, otp: code }).unwrap();
      // Backend returns the built auth response — { ..., token }
      dispatch(setCredentials(res));
      navigate("/"); // or /dashboard, wherever your authed home is
    } catch (err) {
      setError(err?.data?.message || "Invalid or expired code.");
      setOtp(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError("");
    try {
      await resendOtp({ email: form.email }).unwrap();
      setCooldown(30);
      setOtp(["", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
    } catch (err) {
      setError(err?.data?.message || "Could not resend code.");
    }
  };

  const handleBack = () => {
    setStep("register");
    setOtp(["", "", "", "", "", ""]);
    setError("");
  };

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
              {step === "register"
                ? "Start learning smarter — chat, write, code, and print from one place."
                : "One last step. Enter the code we just sent to your inbox."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(step === "register"
                ? ["AI Chat", "Coding", "Assignments", "Docs", "Print"]
                : ["Verify", "Secure", "60s", "Free"]
              ).map((t) => (
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

            {/* Heading — changes per step */}
            <div className="mb-7">
              {step === "register" ? (
                <>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Create your account
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    It only takes a minute. You'll verify your email next.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Verify your email
                  </h1>
                  <p className="mt-2 text-sm text-slate-600">
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-slate-800">
                      {form.email}
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

            {/* ─── Register step ────────────────────────────── */}
            {step === "register" && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Full name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                  />
                </div>

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
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="At least 8 characters"
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

                {/* Student toggle */}
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white/70 p-3.5 transition-colors hover:border-orange-300">
                  <input
                    type="checkbox"
                    name="isStudent"
                    checked={form.isStudent}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-orange-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      I'm a student
                    </p>
                    <p className="text-xs text-slate-500">
                      Adds study tools and school-based printing
                    </p>
                  </div>
                </label>

                {form.isStudent && (
                  <div>
                    <label
                      htmlFor="school"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      School
                    </label>
                    <input
                      id="school"
                      name="school"
                      type="text"
                      value={form.school}
                      onChange={handleChange}
                      placeholder="e.g. University of Lagos"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/15"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isRegistering}
                  className="mt-2 w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isRegistering ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating account…
                    </span>
                  ) : (
                    "Create account"
                  )}
                </button>

                <p className="mt-6 text-center text-sm text-slate-600">
                  Already have an account?{" "}
                  <Link
                    to="/signin"
                    className="font-semibold text-orange-600 hover:text-orange-700"
                  >
                    Sign in
                  </Link>
                </p>
              </form>
            )}

            {/* ─── OTP step ────────────────────────────────── */}
            {step === "otp" && (
              <form onSubmit={handleVerify} className="space-y-6">
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

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="w-full rounded-full bg-orange-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isVerifying ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Verifying…
                    </span>
                  ) : (
                    "Verify & continue"
                  )}
                </button>

                {/* Resend + back */}
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="font-medium text-slate-500 hover:text-slate-700"
                  >
                    ← Change email
                  </button>

                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={cooldown > 0 || isResending}
                    className="font-semibold text-orange-600 transition-colors hover:text-orange-700 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {isResending
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

export default Signup;