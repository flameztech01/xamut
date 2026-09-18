// src/hooks/useDocumentMeta.js
import { useEffect } from "react";

// Ensures a <meta> tag exists for the given selector. Creates it if
// missing, updates the attributes if present.
const ensureMeta = (selector, attrs = {}) => {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) el.removeAttribute(k);
    else el.setAttribute(k, String(v));
  }
  return el;
};

/**
 * Sets the browser tab title and the description meta tag while the
 * calling component is mounted. Restores the previous values on
 * unmount so navigating away doesn't leave stale form metadata behind.
 *
 * Passing `undefined` for either field means "don't touch it".
 *
 * Usage:
 *   useDocumentMeta({
 *     title: "Some form — Xamut",
 *     description: "Fill out the form",
 *   });
 */
export function useDocumentMeta({ title, description } = {}) {
  useEffect(() => {
    const prevTitle = document.title;

    const existingDescEl = document.head.querySelector(
      'meta[name="description"]'
    );
    const prevDesc = existingDescEl
      ? existingDescEl.getAttribute("content")
      : null;
    const descExistedBefore = !!existingDescEl;

    if (title) {
      document.title = title;
    }

    if (description != null) {
      ensureMeta('meta[name="description"]', {
        name: "description",
        content: description,
      });
    }

    return () => {
      document.title = prevTitle;

      if (descExistedBefore) {
        ensureMeta('meta[name="description"]', {
          name: "description",
          content: prevDesc,
        });
      }
    };
  }, [title, description]);
}

export default useDocumentMeta;