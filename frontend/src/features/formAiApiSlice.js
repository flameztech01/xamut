// slices/formAiApiSlice.js
import { apiSlice } from "./apiSlice.js";

const FORM_AI_URL = "/form-ai";

export const formAiApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ─────────────────────────────────────────────────────────
    // SESSIONS
    // ─────────────────────────────────────────────────────────

    // Kick off a new AI session. Mode decides what the AI is doing:
    //   create        — design a brand new form
    //   edit          — change an existing form
    //   collaborators — propose collaborators to add
    //   respond       — compose emails for respondents
    startFormAiSession: builder.mutation({
      query: (data) => ({
        url: `${FORM_AI_URL}/start`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["FormAiSessionList"],
    }),

    // Answer the current pending question. The answer object shape:
    //   { optionId? , optionIds?, otherText?, skip? }
    answerFormAiQuestion: builder.mutation({
      query: ({ sessionId, answer }) => ({
        url: `${FORM_AI_URL}/answer`,
        method: "POST",
        body: { sessionId, answer },
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: "FormAiSession", id: sessionId },
        "FormAiSessionList",
      ],
    }),

    // Send free-text feedback on a preview so the AI redoes the draft.
    regenerateFormAiDraft: builder.mutation({
      query: ({ sessionId, feedback }) => ({
        url: `${FORM_AI_URL}/regenerate`,
        method: "POST",
        body: { sessionId, feedback },
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: "FormAiSession", id: sessionId },
      ],
    }),

    // Small manual tweaks to the draft without an AI round trip.
    // patch can be: { title?, description?, type?, visibility?,
    //                 fields?, settings?, isMultipage?,
    //                 collaborators?, emails? }
    patchFormAiDraft: builder.mutation({
      query: ({ sessionId, patch }) => ({
        url: `${FORM_AI_URL}/patch-draft`,
        method: "POST",
        body: { sessionId, patch },
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: "FormAiSession", id: sessionId },
      ],
    }),

    // Apply the draft. What "apply" means depends on the mode:
    //   create        — creates the form
    //   edit          — saves the changes
    //   collaborators — adds the collaborators
    //   respond       — sends the emails
    confirmFormAiSession: builder.mutation({
      query: ({ sessionId, overrides }) => ({
        url: `${FORM_AI_URL}/confirm`,
        method: "POST",
        body: { sessionId, overrides },
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: "FormAiSession", id: sessionId },
        "FormAiSessionList",
        // Whenever a form is created or edited, refresh the form list too
        "FormList",
      ],
    }),

    // Abandon the session without applying the draft.
    cancelFormAiSession: builder.mutation({
      query: ({ sessionId }) => ({
        url: `${FORM_AI_URL}/cancel`,
        method: "POST",
        body: { sessionId },
      }),
      invalidatesTags: (result, error, { sessionId }) => [
        { type: "FormAiSession", id: sessionId },
        "FormAiSessionList",
      ],
    }),

    // Single session snapshot. Cheap to poll if you want, but the
    // mutations above already return the fresh session on each step,
    // so use this mainly for reload-after-refresh or deep-linking.
    getFormAiSession: builder.query({
      query: (sessionId) => ({
        url: `${FORM_AI_URL}/session/${sessionId}`,
        method: "GET",
      }),
      providesTags: (result, error, sessionId) => [
        { type: "FormAiSession", id: sessionId },
      ],
    }),

    // Recent sessions for the current user.
    listFormAiSessions: builder.query({
      query: () => ({
        url: `${FORM_AI_URL}/sessions`,
        method: "GET",
      }),
      providesTags: ["FormAiSessionList"],
    }),
  }),
});

// ─────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────
export const {
  useStartFormAiSessionMutation,
  useAnswerFormAiQuestionMutation,
  useRegenerateFormAiDraftMutation,
  usePatchFormAiDraftMutation,
  useConfirmFormAiSessionMutation,
  useCancelFormAiSessionMutation,
  useGetFormAiSessionQuery,
  useListFormAiSessionsQuery,
} = formAiApiSlice;