// features/useChatStream.js
//
// Client hook for POST /api/ai/chat/stream (Server-Sent Events over POST).
//
// RTK Query deliberately can't handle SSE — its cache model assumes a
// single JSON response. This hook uses raw fetch + ReadableStream and
// hands each event to the caller as it arrives, so the UI can render
// "Searching the web…" while the turn is still running.
//
// Usage:
//
//   const { stream, cancel, isStreaming, statuses } = useChatStream();
//
//   await stream(
//     { conversationId, message, agent, attachments, forceType },
//     {
//       onStatus: (text) => { ... },     // fired for each status frame
//       onDone:   (evt)  => { ... },     // evt = { conversationId, title, agent, reply }
//       onError:  (err)  => { ... },     // any failure — network, HTTP, or `type: "error"` frame
//     }
//   );
//
// Behavior notes:
//   • isStreaming is true from the moment stream() is called until it
//     resolves (success, error, or abort). Safe to use as a UI gate.
//   • statuses is a rolling list of every status text received in the
//     current turn. The caller decides whether to render all of them or
//     just the last few.
//   • cancel() aborts the in-flight request. onError is NOT called when
//     the abort was user-initiated — the abort is silent.
//   • A new stream() call cancels the previous one automatically, so you
//     can't end up with two parallel turns fighting over state.

import { useCallback, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [statuses, setStatuses] = useState([]);
  const abortRef = useRef(null);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        /* ignore */
      }
      abortRef.current = null;
    }
  }, []);

  const stream = useCallback(
    async (payload, handlers = {}) => {
      const { onStatus, onDone, onError } = handlers;

      // Cancel any previous in-flight stream — prevents "double send"
      // races where a fast user clicks send twice.
      cancel();

      // Fresh status list for this turn
      setStatuses([]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const emitStatus = (text) => {
        if (!text) return;
        setStatuses((prev) => [...prev, text]);
        if (typeof onStatus === "function") onStatus(text);
      };

      try {
        const res = await fetch(`${API_BASE}/api/ai/chat/stream`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            // Explicitly ask for SSE — some proxies need the hint
            Accept: "text/event-stream",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        // ─── Non-streaming error path ──────────────────────
        // Backend can still return a normal JSON error (400/401/404/502)
        // before it opens the stream. Read that and throw a friendly error.
        if (!res.ok || !res.body) {
          let msg = `Request failed (${res.status})`;
          try {
            const data = await res.json();
            msg = data?.message || data?.error || msg;
          } catch {
            try {
              const text = await res.text();
              if (text) msg = text.slice(0, 200);
            } catch {
              /* ignore */
            }
          }
          throw new Error(msg);
        }

        // ─── Parse the SSE stream ──────────────────────────
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // SSE frames are separated by a blank line ("\n\n"). We keep a
        // running buffer and drain complete frames as they arrive.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);

            // Heartbeat / comment line — ignore
            if (!frame || frame.startsWith(":")) continue;

            // A frame may contain multiple "data:" lines; spec says
            // concatenate them with newlines, but our backend always
            // sends exactly one per frame, so we just handle each.
            const lines = frame.split("\n");
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;

              // Strip "data:" and a single optional space
              const json = line.slice(5).replace(/^ /, "");
              let event;
              try {
                event = JSON.parse(json);
              } catch {
                // Bad frame — skip, don't kill the whole stream
                continue;
              }

              if (event.type === "status") {
                emitStatus(event.text);
              } else if (event.type === "done") {
                if (typeof onDone === "function") onDone(event);
              } else if (event.type === "error") {
                if (typeof onError === "function") {
                  onError(new Error(event.message || "Stream error"));
                }
              }
            }
          }
        }
      } catch (err) {
        // User-initiated cancel — silent, don't call onError
        if (err?.name === "AbortError") return;

        if (typeof onError === "function") onError(err);
      } finally {
        setIsStreaming(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [cancel]
  );

  return { stream, cancel, isStreaming, statuses };
}