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

const Welcome = () => {
  const navigate = useNavigate();
  const { userInfo } = useSelector((state) => state.auth);

  // Already signed in? Skip the welcome screen.
  useEffect(() => {
    if (userInfo) navigate("/chat", { replace: true });
  }, [userInfo, navigate]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white md:grid md:grid-cols-2">
      {/* ─── Image side ───────────────────────────────────── */}
      <div className="absolute inset-0 md:relative md:inset-auto md:h-full">
        <img
          src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1400&q=80"
          alt="Students learning together"
          className="h-full w-full object-cover"
        />

        {/* Mobile overlay — strongest at bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/40 md:hidden" />

        {/* Desktop overlay — soft gradient at bottom so the glass card reads well */}
        <div className="absolute inset-0 hidden bg-gradient-to-t from-black/60 via-black/10 to-transparent md:block" />

        {/* ─── Glass card — desktop only ─────────────────── */}
        <div className="absolute inset-x-8 bottom-8 hidden md:block">
          <div className="rounded-2xl border border-white/20 bg-white/10 p-6 backdrop-blur-xl shadow-2xl shadow-black/30">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-orange-300">
                Built for students
              </span>
            </div>
            <p className="text-lg font-medium leading-snug text-white">
              One AI workspace for everything you study — ask, write, code,
              research, and print in minutes.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Chat", "Coding", "Assignments", "Docs", "Print"].map((t) => (
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
      <div className="relative z-10 flex h-full flex-col justify-end px-6 pb-12 text-left md:justify-center md:bg-gradient-to-br md:from-white md:via-orange-50/50 md:to-orange-100/70 md:px-16 md:pb-0">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-24 -right-24 hidden h-80 w-80 rounded-full bg-orange-300/40 blur-3xl md:block" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 hidden h-80 w-80 rounded-full bg-orange-400/25 blur-3xl md:block" />

        {/* Dot grid */}
        <div
          className="pointer-events-none absolute inset-0 hidden opacity-30 md:block"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(251,146,60,0.4) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative max-w-lg">
          {/* Brand */}
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-500 text-lg font-bold text-white shadow-lg shadow-orange-500/40">
              X
            </div>
            <span className="text-2xl font-bold tracking-tight text-white md:text-slate-900">
              Xamut
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl md:text-5xl md:leading-[1.05] md:text-slate-900">
            Your AI study
            <span className="block text-orange-400 md:text-orange-500">
              companion.
            </span>
          </h1>

          {/* Subtext */}
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85 sm:text-base md:text-slate-600">
            Chat, write, code, research, and generate documents — all in one
            place. Made for students who want to understand more and stress
            less.
          </p>

          {/* Feature list — desktop only */}
          <ul className="mt-7 hidden space-y-3 md:block">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
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
                <span className="text-sm text-slate-700">{f}</span>
              </li>
            ))}
          </ul>

          {/* Buttons */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row md:mt-10">
            <Link
              to="/signup"
              className="rounded-full bg-orange-500 px-8 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:bg-orange-600 hover:shadow-orange-500/50"
            >
              Get started
            </Link>
            <Link
              to="/signin"
              className="rounded-full border border-white/40 bg-white/10 px-8 py-3 text-center text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 md:border-slate-200 md:bg-white md:text-slate-800 md:hover:bg-slate-50"
            >
              Sign in
            </Link>
          </div>

          {/* Tiny footnote — desktop only */}
          <p className="mt-6 hidden text-xs text-slate-500 md:block">
            Free to start. No card required.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Welcome;