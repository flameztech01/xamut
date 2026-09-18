// slices/formApiSlice.js
import { apiSlice } from "./apiSlice.js";

const FORM_URL = "/forms";

export const formApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ─────────────────────────────────────────────────────────
    // FORM CRUD
    // ─────────────────────────────────────────────────────────
    createForm: builder.mutation({
      query: (data) => ({
        url: FORM_URL,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["FormList"],
    }),

    listForms: builder.query({
      query: () => ({
        url: FORM_URL,
        method: "GET",
      }),
      providesTags: ["FormList"],
    }),

    getForm: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Form", id }],
    }),

    updateForm: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${FORM_URL}/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Form", id },
        "FormList",
      ],
    }),

    deleteForm: builder.mutation({
      query: (id) => ({
        url: `${FORM_URL}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["FormList"],
    }),

    duplicateForm: builder.mutation({
      query: (id) => ({
        url: `${FORM_URL}/${id}/duplicate`,
        method: "POST",
      }),
      invalidatesTags: ["FormList"],
    }),

    publishForm: builder.mutation({
      query: (id) => ({
        url: `${FORM_URL}/${id}/publish`,
        method: "POST",
      }),
      invalidatesTags: (result, error, id) => [
        { type: "Form", id },
        "FormList",
      ],
    }),

    closeForm: builder.mutation({
      query: (id) => ({
        url: `${FORM_URL}/${id}/close`,
        method: "POST",
      }),
      invalidatesTags: (result, error, id) => [
        { type: "Form", id },
        "FormList",
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // COLLABORATORS
    //
    // Two kinds of people live here:
    //   • Real collaborators — Xamut users with a userId.
    //   • Pending collaborators — invited by email but not signed
    //     up yet. They don't have a userId; they're keyed on email
    //     and are promoted to real collaborators automatically
    //     when they sign up.
    // ─────────────────────────────────────────────────────────
    addCollaborator: builder.mutation({
      query: ({ id, email, role, name }) => ({
        url: `${FORM_URL}/${id}/collaborators`,
        method: "POST",
        body: { email, role, name },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormCollaborators", id },
        { type: "Form", id },
      ],
    }),

    listCollaborators: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/collaborators`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [
        { type: "FormCollaborators", id },
      ],
    }),

    updateCollaboratorRole: builder.mutation({
      query: ({ id, userId, role }) => ({
        url: `${FORM_URL}/${id}/collaborators/${userId}`,
        method: "PUT",
        body: { role },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormCollaborators", id },
      ],
    }),

    removeCollaborator: builder.mutation({
      // Pass `userId` for real collaborators, or `email` for pending
      // invites. The URL ends up the same shape either way — the
      // controller sniffs whether the segment is a Mongo ObjectId.
      query: ({ id, userId, email }) => ({
        url: `${FORM_URL}/${id}/collaborators/${encodeURIComponent(
          userId ?? email
        )}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormCollaborators", id },
        { type: "Form", id },
      ],
    }),

    resendCollaboratorInvite: builder.mutation({
      query: ({ id, email }) => ({
        url: `${FORM_URL}/${id}/collaborators/${encodeURIComponent(
          email
        )}/resend`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormCollaborators", id },
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // PARTICIPANTS (private forms only, no Xamut account needed)
    // ─────────────────────────────────────────────────────────
    addParticipants: builder.mutation({
      query: ({ id, participants }) => ({
        url: `${FORM_URL}/${id}/participants`,
        method: "POST",
        body: { participants },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormParticipants", id },
        { type: "Form", id },
      ],
    }),

    listParticipants: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/participants`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [
        { type: "FormParticipants", id },
      ],
    }),

    removeParticipant: builder.mutation({
      query: ({ id, participantId }) => ({
        url: `${FORM_URL}/${id}/participants/${participantId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormParticipants", id },
        { type: "Form", id },
      ],
    }),

    resendParticipantCredentials: builder.mutation({
      query: ({ id, participantId }) => ({
        url: `${FORM_URL}/${id}/participants/${participantId}/resend`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormParticipants", id },
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // PUBLIC / RESPONDENT
    //
    // These do NOT require Xamut auth. For private forms, pass the
    // participant token via `participantToken` and RTK Query will
    // send it as `Authorization: Bearer <token>`. It's separate from
    // the user's own auth token, so it doesn't collide with anything
    // the base query already attaches.
    // ─────────────────────────────────────────────────────────
    getPublicForm: builder.query({
      query: ({ slug, participantToken }) => ({
        url: `${FORM_URL}/public/${slug}`,
        method: "GET",
        headers: participantToken
          ? { Authorization: `Bearer ${participantToken}` }
          : undefined,
      }),
    }),

    participantLogin: builder.mutation({
      query: ({ slug, email, password }) => ({
        url: `${FORM_URL}/public/${slug}/login`,
        method: "POST",
        body: { email, password },
      }),
    }),

    submitResponse: builder.mutation({
      query: ({ slug, participantToken, ...data }) => ({
        url: `${FORM_URL}/public/${slug}/submit`,
        method: "POST",
        body: data,
        headers: participantToken
          ? { Authorization: `Bearer ${participantToken}` }
          : undefined,
      }),
      invalidatesTags: (result, error, { formId }) =>
        formId
          ? [
              { type: "FormResponses", id: formId },
              { type: "FormStats", id: formId },
              { type: "Form", id: formId },
            ]
          : [],
    }),

    // ─────────────────────────────────────────────────────────
    // RESPONSES
    // ─────────────────────────────────────────────────────────
    listResponses: builder.query({
      query: ({ id, page = 1, limit = 50, q = "" }) => ({
        url: `${FORM_URL}/${id}/responses`,
        method: "GET",
        params: { page, limit, q },
      }),
      providesTags: (result, error, { id }) => [
        { type: "FormResponses", id },
      ],
    }),

    getResponse: builder.query({
      query: ({ id, responseId }) => ({
        url: `${FORM_URL}/${id}/responses/${responseId}`,
        method: "GET",
      }),
      providesTags: (result, error, { id, responseId }) => [
        { type: "FormResponse", id, responseId },
      ],
    }),

    deleteResponse: builder.mutation({
      query: ({ id, responseId }) => ({
        url: `${FORM_URL}/${id}/responses/${responseId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormResponses", id },
        { type: "FormStats", id },
        { type: "Form", id },
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // ANALYTICS
    // ─────────────────────────────────────────────────────────
    getFormStats: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/stats`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "FormStats", id }],
    }),

    getLeaderboard: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/leaderboard`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "FormStats", id }],
    }),

    exportResponses: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/export`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [
        { type: "FormResponses", id },
      ],
    }),
  }),
});

// ─────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────
export const {
  // CRUD
  useCreateFormMutation,
  useListFormsQuery,
  useGetFormQuery,
  useUpdateFormMutation,
  useDeleteFormMutation,
  useDuplicateFormMutation,
  usePublishFormMutation,
  useCloseFormMutation,

  // Collaborators
  useAddCollaboratorMutation,
  useListCollaboratorsQuery,
  useUpdateCollaboratorRoleMutation,
  useRemoveCollaboratorMutation,
  useResendCollaboratorInviteMutation,

  // Participants
  useAddParticipantsMutation,
  useListParticipantsQuery,
  useRemoveParticipantMutation,
  useResendParticipantCredentialsMutation,

  // Public
  useGetPublicFormQuery,
  useParticipantLoginMutation,
  useSubmitResponseMutation,

  // Responses
  useListResponsesQuery,
  useGetResponseQuery,
  useDeleteResponseMutation,

  // Analytics
  useGetFormStatsQuery,
  useGetLeaderboardQuery,
  useExportResponsesQuery,
} = formApiSlice;