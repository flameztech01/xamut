// pages/WhatsAppSettings.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  useGetWhatsappConnectionQuery,
  useStartWhatsappConnectMutation,
  useCompleteWhatsappConnectMutation,
  useDisconnectWhatsappMutation,
} from "../features/whatsappApiSlice";

// ─────────────────────────────────────────────────────────────
// Meta SDK loader
//
// Meta's SDK must be loaded exactly once per page, and only after
// window.fbAsyncInit is defined. We wrap the whole dance in a
// promise so the calling component can just `await loadMetaSdk()`.
// ─────────────────────────────────────────────────────────────
const META_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";

let _metaSdkPromise = null;

const loadMetaSdk = (appId, version = "v20.0") => {
  if (typeof window === "undefined") return Promise.reject(new Error("No window."));
  if (window.FB && window.FB.init) {
    // Already loaded on this page — just re-init with our app ID
    // (harmless if it's the same) and resolve.
    window.FB.init({ appId, version, xfbml: false, cookie: false });
    return Promise.resolve(window.FB);
  }
  if (_metaSdkPromise) return _metaSdkPromise;

  _metaSdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      try {
        window.FB.init({ appId, version, xfbml: false, cookie: false });
        resolve(window.FB);
      } catch (err) {
        reject(err);
      }
    };

    // If a script tag already exists (StrictMode double-mount), reuse it.
    const existing = document.querySelector(`script[src="${META_SDK_SRC}"]`);
    if (existing) return;

    const script = document.createElement("script");
    script.src = META_SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () =>
      reject(new Error("Could not load the Meta SDK. Check your connection."));
    document.body.appendChild(script);
  });

  return _metaSdkPromise;
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
  whatsapp: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.1.2-.3.2-.4.1-.2 0-.3 0-.4 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5-.2 0-.4 0-.6 0s-.6.1-.9.4c-.3.3-1.1 1.1-1.1 2.6 0 1.5 1.1 3 1.3 3.2.1.2 2.2 3.4 5.3 4.7.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z" />
      <path d="M12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 4.9L2 22l5.2-1.3c1.4.8 3.1 1.3 4.8 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3C4 15 3.5 13.5 3.5 12c0-4.7 3.8-8.5 8.5-8.5s8.5 3.8 8.5 8.5-3.8 8.2-8.5 8.2z" />
    </svg>
  ),
  check: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={c}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
    </svg>
  ),
  alert: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
    </svg>
  ),
  spinner: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={`animate-spin ${c}`}>
      <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
    </svg>
  ),
  external: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  phone: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  shield: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Connect button — encapsulates the entire Meta Embedded Signup
// handshake so the page just renders <ConnectFlow /> and moves on.
//
// Steps:
//   1. POST /whatsapp/connect/start → get fbAppId + configId
//   2. loadMetaSdk(fbAppId) → ensure window.FB is ready
//   3. window.FB.login({ config_id, response_type: "code" })
//      opens the Embedded Signup popup. The user completes it,
//      linking their WhatsApp Business number.
//   4. Meta returns an auth code + (via postMessage) the wabaId,
//      phoneNumberId, and businessId.
//   5. POST /whatsapp/connect/callback → Twilio registers the sender.
// ─────────────────────────────────────────────────────────────
const ConnectFlow = ({ onConnected }) => {
  const [startConnect] = useStartWhatsappConnectMutation();
  const [completeConnect] = useCompleteWhatsappConnectMutation();

  const [phase, setPhase] = useState("preparing");
  // phase: preparing | ready | awaiting_meta | finalizing | error
  const [error, setError] = useState("");
  const configRef = useRef(null);
  const sessionDataRef = useRef(null);

  // Prefetch the subaccount + Meta SDK as soon as this mounts, so the
  // click handler can call FB.login() synchronously. Popups only open
  // reliably in the same tick as the user gesture that triggers them —
  // any await before FB.login() breaks that chain and the popup gets
  // silently blocked (which looks exactly like "stuck on Waiting for Meta").
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await startConnect().unwrap();
        if (cancelled) return;

        if (res.alreadyConnected) {
          onConnected?.();
          return;
        }

        if (!res.config?.fbAppId || !res.config?.configId) {
          setError(
            "WhatsApp integration isn't configured on the server yet. Contact support."
          );
          setPhase("error");
          return;
        }

        configRef.current = res.config;
        await loadMetaSdk(res.config.fbAppId, res.config.graphApiVersion || "v20.0");
        if (cancelled) return;
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setError(
          err?.data?.message || err?.message || "Couldn't prepare the connection. Refresh and try again."
        );
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const data = JSON.parse(event.data);
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          if (data.event === "FINISH") {
            sessionDataRef.current = {
              wabaId: data.data?.waba_id || null,
              phoneNumberId: data.data?.phone_number_id || null,
              businessId: data.data?.business_id || null,
            };
          } else if (data.event === "CANCEL") {
            sessionDataRef.current = null;
          } else if (data.event === "ERROR") {
            sessionDataRef.current = null;
            setError(data.data?.error_message || "Meta reported an error during signup.");
          }
        }
      } catch {
        /* not our message */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // No `await` before window.FB.login() — it must run synchronously
  // inside this click handler.
  const handleConnect = () => {
    setError("");

    if (phase !== "ready" || !configRef.current) return; // still preparing

    sessionDataRef.current = null;
    setPhase("awaiting_meta");

    window.FB.login(
      async (response) => {
        const code = response?.authResponse?.code;

        const waitStart = Date.now();
        while (!sessionDataRef.current && Date.now() - waitStart < 800) {
          await new Promise((r) => setTimeout(r, 40));
        }

        if (!code) {
          setPhase("ready");
          setError("You cancelled the Meta signup. Nothing was changed.");
          return;
        }

        const session = sessionDataRef.current;
        if (!session?.wabaId || !session?.phoneNumberId) {
          setPhase("ready");
          setError("Meta didn't return the WhatsApp business details. Try again.");
          return;
        }

        setPhase("finalizing");

        try {
          await completeConnect({
            code,
            wabaId: session.wabaId,
            phoneNumberId: session.phoneNumberId,
            businessId: session.businessId,
          }).unwrap();
          onConnected?.();
        } catch (err) {
          setPhase("ready");
          setError(err?.data?.message || "Twilio couldn't finish the connection. Try again.");
        }
      },
      {
        config_id: configRef.current.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
        },
      }
    );
  };

  const busy = phase === "preparing" || phase === "awaiting_meta" || phase === "finalizing";
  const label =
    phase === "preparing"
      ? "Preparing…"
      : phase === "awaiting_meta"
      ? "Waiting for Meta…"
      : phase === "finalizing"
      ? "Finishing up…"
      : "Connect WhatsApp";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleConnect}
        disabled={busy || phase === "error"}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-teal-600 px-5 py-3 text-[13.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:hover:bg-teal-400"
      >
        {busy ? I.spinner("h-4 w-4") : I.whatsapp("h-4 w-4")}
        {label}
      </button>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <span className="mt-0.5 shrink-0">{I.alert("h-4 w-4")}</span>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Disconnect confirm modal
// ─────────────────────────────────────────────────────────────
const DisconnectModal = ({ open, onClose, onConfirm, busy }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/50 px-4 backdrop-blur-[3px] dark:bg-black/60">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-stone-900">
        <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Disconnect WhatsApp?
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
          Your number will be released from Xamut. Your message history stays
          in your account, but you won't be able to send or receive until you
          reconnect.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-red-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-red-500/25 transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────
const LoadingScreen = () => (
  <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-stone-950">
    <div className="flex flex-col items-center gap-3">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
      <p className="text-[12px] text-stone-400 dark:text-stone-500">
        Loading WhatsApp settings…
      </p>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Connected card
// ─────────────────────────────────────────────────────────────
const ConnectedCard = ({ connection, onDisconnect, busy }) => {
  const quality =
    connection.qualityRating === "GREEN"
      ? {
          label: "High quality",
          chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
          dot: "bg-emerald-500",
        }
      : connection.qualityRating === "YELLOW"
      ? {
          label: "Medium quality",
          chip: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
          dot: "bg-amber-500",
        }
      : connection.qualityRating === "RED"
      ? {
          label: "Low quality",
          chip: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
          dot: "bg-red-400",
        }
      : null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-stone-200/80 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400">
            {I.check("h-5 w-5")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Connected
              </h3>
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
              Your WhatsApp Business number is linked to Xamut. Messages you
              send from here go out through this number.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 border-t border-stone-100 pt-4 dark:border-stone-800 sm:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Phone number
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold text-stone-900 dark:text-stone-100">
              <span className="text-stone-400 dark:text-stone-500">
                {I.phone("h-3.5 w-3.5")}
              </span>
              {connection.phoneNumber || "—"}
            </p>
          </div>
          {connection.displayName ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Profile name
              </p>
              <p className="mt-1 truncate text-[14px] font-semibold text-stone-900 dark:text-stone-100">
                {connection.displayName}
              </p>
            </div>
          ) : null}
          {quality ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Quality rating
              </p>
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${quality.chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${quality.dot}`} />
                {quality.label}
              </span>
            </div>
          ) : null}
          {connection.connectedAt ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Connected since
              </p>
              <p className="mt-1 text-[12.5px] text-stone-700 dark:text-stone-300">
                {new Date(connection.connectedAt).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Disconnect number
            </p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              Release this number from Xamut. You can reconnect anytime.
            </p>
          </div>
          <button
            type="button"
            onClick={onDisconnect}
            disabled={busy}
            className="shrink-0 rounded-md border border-red-200 bg-white px-3.5 py-2 text-[12px] font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:bg-stone-900 dark:text-red-400 dark:hover:border-red-500/50 dark:hover:bg-red-500/10"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Not-connected card
// ─────────────────────────────────────────────────────────────
const NotConnectedCard = ({ onConnected }) => (
  <div className="space-y-5">
    <div className="rounded-lg border border-stone-200/80 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/25">
          {I.whatsapp("h-6 w-6")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Connect your WhatsApp number
          </h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
            Link a WhatsApp Business number to Xamut so you can send and
            receive messages from your dashboard.
          </p>
        </div>
      </div>

      <ConnectFlow onConnected={onConnected} />
    </div>

    <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-400">
        {I.alert("h-3.5 w-3.5")}
        Before you start
      </p>
      <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-amber-900 dark:text-amber-200/90">
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
          <span>
            You'll need a <strong>WhatsApp Business number</strong> — a
            number not currently linked to the regular WhatsApp app. If it is,
            delete it from the app first.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
          <span>
            You'll log in with your <strong>Facebook Business account</strong>{" "}
            during the connection step.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
          <span>
            Once connected, you'll view and reply to messages from the Xamut
            inbox, not from the WhatsApp app on your phone.
          </span>
        </li>
      </ul>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
const WhatsAppSettings = () => {
  const navigate = useNavigate();

  const {
    data: connData,
    isLoading,
    error,
    refetch,
  } = useGetWhatsappConnectionQuery();

  const [disconnectWa, { isLoading: disconnecting }] =
    useDisconnectWhatsappMutation();

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [toast, setToast] = useState("");

  const connection = connData?.connection || null;
  const isConnected = connection?.status === "connected";

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const handleConnected = async () => {
    await refetch();
    showToast("WhatsApp connected.");
  };

  const handleDisconnect = async () => {
    try {
      await disconnectWa().unwrap();
      setConfirmDisconnect(false);
      showToast("WhatsApp disconnected.");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't disconnect. Try again.");
    }
  };

  if (isLoading) return <LoadingScreen />;

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white px-4 text-center dark:bg-stone-950">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400">
          {I.alert("h-6 w-6")}
        </span>
        <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
          Couldn't load WhatsApp settings
        </p>
        <p className="max-w-sm text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
          {error?.data?.message || "Please try again in a moment."}
        </p>
        <button
          type="button"
          onClick={refetch}
          className="mt-2 rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <header
        className="sticky top-0 z-20 border-b border-stone-200/70 bg-white/90 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/90"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2.5 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            aria-label="Back"
          >
            {I.back("h-4 w-4")}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              WhatsApp
            </h1>
            <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
              {isConnected ? "Connected" : "Not connected"}
            </p>
          </div>
          {isConnected ? (
            <Link
              to="/whatsapp"
              className="hidden items-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-500 dark:hover:bg-teal-400 sm:flex"
            >
              Open inbox
              {I.external("h-3.5 w-3.5")}
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h2 className="text-[22px] font-semibold leading-tight tracking-tight text-stone-900 dark:text-stone-100 sm:text-[26px]">
            WhatsApp settings
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
            Manage the WhatsApp Business number linked to your Xamut account.
          </p>
        </div>

        {isConnected ? (
          <ConnectedCard
            connection={connection}
            onDisconnect={() => setConfirmDisconnect(true)}
            busy={disconnecting}
          />
        ) : (
          <NotConnectedCard onConnected={handleConnected} />
        )}

        <div className="mt-8 rounded-lg border border-stone-200/80 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/50">
          <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {I.shield("h-3.5 w-3.5")}
            Powered by Twilio & Meta
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
            Message delivery is handled by Twilio on behalf of Meta's WhatsApp
            Business Platform. Your number stays yours — disconnecting
            releases it instantly.
          </p>
        </div>
      </main>

      <DisconnectModal
        open={confirmDisconnect}
        onClose={() => !disconnecting && setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
        busy={disconnecting}
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

export default WhatsAppSettings;