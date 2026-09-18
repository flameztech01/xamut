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

// ─────────────────────────────────────────────────────────────
// Brand mark
// ─────────────────────────────────────────────────────────────
const XamutMark = ({ className = "h-10 w-10" }) => (
  <div
    className={`${className} flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-400 via-teal-500 to-teal-600 text-lg font-bold text-white shadow-md shadow-teal-500/40`}
  >
    X
  </div>
);

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const IconEye = ({ className = "h-5 w-5" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
  >
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconEyeOff = ({ className = "h-5 w-5" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className={className}
  >
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M9.9 5.1A10.9 10.9 0 0 1 12 5c5 0 9 4.5 9 7a11.8 11.8 0 0 1-2.2 3.6" />
    <path d="M6.6 6.6C4 8.2 3 11 3 12c0 1.5 4 7 9 7 1.2 0 2.3-.3 3.3-.7" />
  </svg>
);

const IconAlert = ({ className = "h-4 w-4" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    className={className}
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
  </svg>
);

const Signup = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const [register, { isLoading: isRegistering }] = useRegisterMutation();
  const [verifyOtp, { isLoading: isVerifying }] = useVerifyOtpMutation();
  const [resendOtp, { isLoading: isResending }] = useResendOtpMutation();

  // "register" | "otp"
  const [step, setStep] = useState("register");

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

  useEffect(() => {
    if (step === "otp") {
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
      dispatch(setCredentials(res));
      navigate("/");
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

        <Link to="/" className="absolute left-8 top-8 flex items-center gap-2.5">
          <XamutMark className="h-10 w-10" />
          <span className="text-xl font-bold tracking-tight text-white">
            Xamut
          </span>
        </Link>

        <div className="absolute inset-x-8 bottom-8">
          <div className="rounded-xl border border-white/20 bg-white/10 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <p className="text-[17px] font-medium leading-snug text-white">
              {step === "register"
                ? "Start learning smarter. Chat, write, code, and print from one place."
                : "One last step. Enter the code we just sent to your inbox."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(step === "register"
                ? ["AI Chat", "Coding", "Assignments", "Docs", "Print"]
                : ["Verify", "Secure", "60s", "Free"]
              ).map((t) => (
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
            <Link to="/" className="mb-7 flex items-center gap-2.5 md:hidden">
              <XamutMark className="h-10 w-10" />
              <span className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
                Xamut
              </span>
            </Link>

            <div className="mb-7">
              {step === "register" ? (
                <>
                  <h1 className="text-[26px] font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
                    Create your account
                  </h1>
                  <p className="mt-2 text-[13.5px] text-stone-500 dark:text-stone-400">
                    It only takes a minute. You'll verify your email next.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-[26px] font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-[30px]">
                    Verify your email
                  </h1>
                  <p className="mt-2 text-[13.5px] text-stone-500 dark:text-stone-400">
                    We sent a 6-digit code to{" "}
                    <span className="font-medium text-stone-800 dark:text-stone-200">
                      {form.email}
                    </span>
                  </p>
                </>
              )}
            </div>

            {error ? (
              <div className="mb-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <IconAlert className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            {step === "register" ? (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label
                    htmlFor="name"
                    className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
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
                    className={inputClass}
                  />
                </div>

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
                  <label
                    htmlFor="password"
                    className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
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
                      className={`${inputClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-stone-200 bg-white p-3.5 transition-colors hover:border-teal-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-teal-500/50">
                  <input
                    type="checkbox"
                    name="isStudent"
                    checked={form.isStudent}
                    onChange={handleChange}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-teal-500"
                  />
                  <div>
                    <p className="text-[13.5px] font-medium text-stone-800 dark:text-stone-100">
                      I'm a student
                    </p>
                    <p className="text-[11.5px] text-stone-500 dark:text-stone-400">
                      Adds study tools and school-based printing
                    </p>
                  </div>
                </label>

                {form.isStudent ? (
                  <div>
                    <label
                      htmlFor="school"
                      className="mb-1.5 block text-[12.5px] font-medium text-stone-700 dark:text-stone-300"
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
                      className={inputClass}
                    />
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={isRegistering}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {isRegistering ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Creating account…
                    </>
                  ) : (
                    "Create account"
                  )}
                </button>

                <p className="mt-6 text-center text-[13px] text-stone-500 dark:text-stone-400">
                  Already have an account?{" "}
                  <Link
                    to="/signin"
                    className="font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
                  >
                    Sign in
                  </Link>
                </p>
              </form>
            ) : null}

            {step === "otp" ? (
              <form onSubmit={handleVerify} className="space-y-6">
                <div
                  className="flex items-center justify-between gap-1.5 sm:gap-2"
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
                      className="h-12 w-full max-w-[3rem] rounded-md border border-stone-200 bg-white text-center text-[18px] font-semibold text-stone-900 outline-none transition-all focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-teal-500/60 sm:h-14 sm:max-w-[3.25rem] sm:text-[20px]"
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={isVerifying}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-6 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  {isVerifying ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Verifying…
                    </>
                  ) : (
                    "Verify & continue"
                  )}
                </button>

                <div className="flex items-center justify-between text-[13px]">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="font-medium text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                  >
                    ← Change email
                  </button>

                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={cooldown > 0 || isResending}
                    className="font-semibold text-teal-600 transition-colors hover:text-teal-700 disabled:cursor-not-allowed disabled:text-stone-400 dark:text-teal-400 dark:hover:text-teal-300 dark:disabled:text-stone-600"
                  >
                    {isResending
                      ? "Sending…"
                      : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Resend code"}
                  </button>
                </div>

                <p className="text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                  Didn't get it? Check spam, or use the resend button.
                </p>
              </form>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;