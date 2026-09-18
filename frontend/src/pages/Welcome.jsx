// pages/Welcome.jsx
import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useSelector } from "react-redux";

const FEATURES = [
  "Chat with an AI that remembers you",
  "Write, code, and research in one place",
  "Generate documents and slides",
  "Print straight to a cyber café",
];

const XamutMark = ({ className = "h-11 w-11" }) => (
  <div
    className={`${className} flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-400 via-teal-500 to-teal-600 text-lg font-bold text-white shadow-md shadow-teal-500/40`}
  >
    X
  </div>
);

const Welcome = () => {
  const navigate = useNavigate();
  const { userInfo } = useSelector((state) => state.auth);

  // Already signed in? Skip the welcome screen.
  useEffect(() => {
    if (userInfo) navigate("/chat", { replace: true });
  }, [userInfo, navigate]);

  return (
    <div className="relative min-h-dvh w-full overflow-hidden bg-stone-50 dark:bg-stone-950 md:grid md:min-h-dvh md:grid-cols-2">
      {/* ─── Image side ───────────────────────────────────── */}
      <div className="absolute inset-0 md:relative md:inset-auto md:h-full">
        <img
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80"
          alt="Students learning together"
          className="h-full w-full object-cover"
        />

        {/* Mobile overlay — strongest at bottom for content legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/40 md:hidden" />

        {/* Desktop overlay — subtle, so the glass card reads well */}
        <div className="absolute inset-0 hidden bg-gradient-to-t from-black/65 via-black/15 to-transparent md:block" />

        {/* Glass card — desktop only */}
        <div className="absolute inset-x-8 bottom-8 hidden md:block">
          <div className="rounded-xl border border-white/20 bg-white/10 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-teal-400" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-300">
                Built for students
              </span>
            </div>
            <p className="text-[17px] font-medium leading-snug text-white">
              One AI workspace for everything you study. Ask, write, code,
              research, and print in minutes.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Chat", "Coding", "Assignments", "Docs", "Print"].map((t) => (
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
      <div className="relative z-10 flex min-h-dvh flex-col justify-end px-5 pb-10 text-left sm:px-6 sm:pb-12 md:min-h-0 md:justify-center md:bg-gradient-to-br md:from-white md:via-teal-50/40 md:to-teal-100/60 md:px-14 md:pb-0 md:dark:from-stone-950 md:dark:via-stone-950 md:dark:to-teal-950/40 lg:px-20">
        {/* Decorative blobs — desktop only */}
        <div className="pointer-events-none absolute -top-24 -right-24 hidden h-80 w-80 rounded-full bg-teal-300/30 blur-3xl dark:bg-teal-500/10 md:block" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 hidden h-80 w-80 rounded-full bg-teal-400/20 blur-3xl dark:bg-teal-500/10 md:block" />

        {/* Dot grid — desktop only */}
        <div
          className="pointer-events-none absolute inset-0 hidden opacity-30 dark:opacity-15 md:block"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(20,184,166,0.35) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative mx-auto w-full max-w-lg md:mx-0">
          {/* Brand */}
          <div className="mb-6 flex items-center gap-2.5">
            <XamutMark className="h-11 w-11" />
            <span className="text-2xl font-bold tracking-tight text-white md:text-stone-900 md:dark:text-stone-100">
              Xamut
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-[32px] font-bold leading-[1.1] tracking-tight text-white sm:text-4xl md:text-[44px] md:leading-[1.05] md:text-stone-900 md:dark:text-stone-100 lg:text-5xl">
            Your AI study
            <span className="block text-teal-400 md:text-teal-600 md:dark:text-teal-400">
              companion.
            </span>
          </h1>

          {/* Subtext */}
          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-white/85 sm:text-base md:text-stone-600 md:dark:text-stone-400">
            Chat, write, code, research, and generate documents. All in one
            place. Made for students who want to understand more and stress
            less.
          </p>

          {/* Feature list — desktop only */}
          <ul className="mt-7 hidden space-y-3 md:block">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
                <span className="text-[13.5px] text-stone-700 dark:text-stone-300">
                  {f}
                </span>
              </li>
            ))}
          </ul>

          {/* Buttons */}
          <div className="mt-8 flex flex-col gap-2.5 sm:flex-row md:mt-10">
            <Link
              to="/signup"
              className="rounded-md bg-teal-600 px-7 py-3 text-center text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 hover:shadow-md active:scale-[0.98] dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              Get started
            </Link>
            <Link
              to="/signin"
              className="rounded-md border border-white/40 bg-white/10 px-7 py-3 text-center text-[13.5px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 md:border-stone-200 md:bg-white md:text-stone-800 md:hover:border-stone-300 md:hover:bg-stone-50 md:dark:border-stone-700 md:dark:bg-stone-900 md:dark:text-stone-100 md:dark:hover:border-stone-600 md:dark:hover:bg-stone-800"
            >
              Sign in
            </Link>
          </div>

          {/* Footnote — desktop only */}
          <p className="mt-6 hidden text-[11.5px] text-stone-500 dark:text-stone-500 md:block">
            Free to start. No card required.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Welcome;