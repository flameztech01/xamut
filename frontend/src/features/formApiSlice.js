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
    // COVER PHOTO (Cloudinary)
    // ─────────────────────────────────────────────────────────
    uploadFormCover: builder.mutation({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append("coverPhoto", file);
        return {
          url: `${FORM_URL}/${id}/cover`,
          method: "POST",
          body,
          formData: true,
        };
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "Form", id },
        "FormList",
      ],
    }),

    removeFormCover: builder.mutation({
      query: (id) => ({
        url: `${FORM_URL}/${id}/cover`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, id) => [
        { type: "Form", id },
        "FormList",
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // EDITOR MEDIA (candidate photos for elections, etc.)
    //
    // Returns { url, filename, mimetype, size }. The client puts
    // `url` into positions[].candidates[].photoUrl and then PUTs
    // the whole form.
    // ─────────────────────────────────────────────────────────
    uploadFormMediaEditor: builder.mutation({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append("file", file);
        return {
          url: `${FORM_URL}/${id}/media`,
          method: "POST",
          body,
          formData: true,
        };
      },
      // No invalidations — the form isn't changed server-side by
      // this call; the client must still PUT the new URL onto it.
    }),

    // ─────────────────────────────────────────────────────────
    // COLLABORATORS
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
    // ACCESS REQUESTS (private forms — self-serve password requests)
    // ─────────────────────────────────────────────────────────
    requestAccess: builder.mutation({
      // Public — no Xamut auth needed.
      // body: { email, name?, note?, extraInfo? }
      query: ({ slug, ...body }) => ({
        url: `${FORM_URL}/public/${slug}/request-access`,
        method: "POST",
        body,
      }),
    }),

    listAccessRequests: builder.query({
      // Optional filter: ?status=pending|approved|rejected
      query: ({ id, status }) => ({
        url: `${FORM_URL}/${id}/access-requests`,
        method: "GET",
        params: status ? { status } : undefined,
      }),
      providesTags: (result, error, { id }) => [
        { type: "FormAccessRequests", id },
      ],
    }),

    approveAccessRequest: builder.mutation({
      query: ({ id, requestId, note }) => ({
        url: `${FORM_URL}/${id}/access-requests/${requestId}/approve`,
        method: "POST",
        body: { note },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormAccessRequests", id },
        { type: "FormParticipants", id },
        { type: "Form", id },
      ],
    }),

    rejectAccessRequest: builder.mutation({
      query: ({ id, requestId, note }) => ({
        url: `${FORM_URL}/${id}/access-requests/${requestId}/reject`,
        method: "POST",
        body: { note },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormAccessRequests", id },
      ],
    }),

    bulkReviewAccessRequests: builder.mutation({
      // action: "approve" | "reject"
      query: ({ id, ids, action, note }) => ({
        url: `${FORM_URL}/${id}/access-requests/bulk`,
        method: "POST",
        body: { ids, action, note },
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "FormAccessRequests", id },
        { type: "FormParticipants", id },
        { type: "Form", id },
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // DRAFTS (autosave in-progress answers)
    //
    // Pass `participantToken` for private forms; the API slice's
    // base query also attaches the logged-in user's token if any,
    // so signed-in drafts are scoped to the user, anonymous drafts
    // are scoped to `sessionKey`.
    //
    // Provide a `sessionKey` (client-generated, stable per tab or
    // device) for anonymous drafts. Without one, only signed-in
    // users can save drafts.
    // ─────────────────────────────────────────────────────────
    saveDraft: builder.mutation({
      // body: { answers, sessionKey?, startedAt?, email?, name? }
      query: ({ slug, participantToken, ...body }) => ({
        url: `${FORM_URL}/public/${slug}/draft`,
        method: "POST",
        body,
        headers: participantToken
          ? { Authorization: `Bearer ${participantToken}` }
          : undefined,
      }),
    }),

    getDraft: builder.query({
      // params: { sessionKey?, participantToken? }
      query: ({ slug, sessionKey, participantToken }) => ({
        url: `${FORM_URL}/public/${slug}/draft`,
        method: "GET",
        params: sessionKey ? { sessionKey } : undefined,
        headers: participantToken
          ? { Authorization: `Bearer ${participantToken}` }
          : undefined,
      }),
    }),

    clearDraft: builder.mutation({
      query: ({ slug, sessionKey, participantToken }) => ({
        url: `${FORM_URL}/public/${slug}/draft`,
        method: "DELETE",
        body: sessionKey ? { sessionKey } : undefined,
        headers: participantToken
          ? { Authorization: `Bearer ${participantToken}` }
          : undefined,
      }),
    }),

    // Logged-in user's own unfinished submissions.
    listMyPendingForms: builder.query({
      query: () => ({
        url: `${FORM_URL}/drafts/pending`,
        method: "GET",
      }),
      providesTags: ["MyPendingForms"],
    }),

    // ─────────────────────────────────────────────────────────
    // PUBLIC / RESPONDENT
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

    uploadFormMedia: builder.mutation({
      query: ({ slug, file, participantToken }) => {
        const body = new FormData();
        body.append("file", file);
        return {
          url: `${FORM_URL}/public/${slug}/upload`,
          method: "POST",
          body,
          formData: true,
          headers: participantToken
            ? { Authorization: `Bearer ${participantToken}` }
            : undefined,
        };
      },
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
              "MyPendingForms",
            ]
          : ["MyPendingForms"],
    }),

    // ─────────────────────────────────────────────────────────
    // ELECTION RESULTS
    //
    // getOwnerElectionResults — authenticated, owner/collaborator,
    // always allowed regardless of `settings.showLiveResults`.
    //
    // getPublicElectionResults — public but requires the
    // `resultsToken` that was returned by submitResponse. Pass it
    // as `resultsToken`; it's sent as `?rt=...`.
    // ─────────────────────────────────────────────────────────
    getOwnerElectionResults: builder.query({
      query: (id) => ({
        url: `${FORM_URL}/${id}/election-results`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [
        { type: "FormElectionResults", id },
      ],
    }),

    getPublicElectionResults: builder.query({
      query: ({ slug, resultsToken }) => ({
        url: `${FORM_URL}/public/${slug}/results`,
        method: "GET",
        params: { rt: resultsToken },
      }),
      providesTags: (result, error, { slug }) => [
        { type: "PublicElectionResults", slug },
      ],
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
        { type: "FormElectionResults", id },
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

  // Cover photo
  useUploadFormCoverMutation,
  useRemoveFormCoverMutation,

  // Editor media (candidate photos, etc.)
  useUploadFormMediaEditorMutation,

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

  // Access requests
  useRequestAccessMutation,
  useListAccessRequestsQuery,
  useApproveAccessRequestMutation,
  useRejectAccessRequestMutation,
  useBulkReviewAccessRequestsMutation,

  // Drafts
  useSaveDraftMutation,
  useGetDraftQuery,
  useClearDraftMutation,
  useListMyPendingFormsQuery,

  // Public
  useGetPublicFormQuery,
  useParticipantLoginMutation,
  useUploadFormMediaMutation,
  useSubmitResponseMutation,

  // Election results
  useGetOwnerElectionResultsQuery,
  useGetPublicElectionResultsQuery,

  // Responses
  useListResponsesQuery,
  useGetResponseQuery,
  useDeleteResponseMutation,

  // Analytics
  useGetFormStatsQuery,
  useGetLeaderboardQuery,
  useExportResponsesQuery,
} = formApiSlice;