// features/aiApiSlice.js
import { apiSlice } from "./apiSlice.js";

const AI_URL = "/ai";

export const aiApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ─── Uploads ──────────────────────────────────────────────
    uploadAttachment: builder.mutation({
      query: (formData) => ({
        url: `${AI_URL}/upload`,
        method: "POST",
        body: formData,
      }),
    }),
    uploadImage: builder.mutation({
      query: (formData) => ({
        url: `${AI_URL}/upload/image`,
        method: "POST",
        body: formData,
      }),
    }),

    // ─── Chat ─────────────────────────────────────────────────
    sendMessage: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/chat`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: [
        "Conversation",
        "ConversationList",
        "DocumentList",
        "ClipList",
      ],
    }),

    // ─── Conversations ────────────────────────────────────────
    listConversations: builder.query({
      query: () => ({
        url: `${AI_URL}/conversations`,
        method: "GET",
      }),
      providesTags: ["ConversationList"],
    }),
    getConversation: builder.query({
      query: (id) => ({
        url: `${AI_URL}/conversations/${id}`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Conversation", id }],
    }),
    createConversation: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/conversations`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["ConversationList"],
    }),
    updateConversation: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${AI_URL}/conversations/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Conversation", id },
        "ConversationList",
      ],
    }),
    deleteConversation: builder.mutation({
      query: (id) => ({
        url: `${AI_URL}/conversations/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["ConversationList"],
    }),

    // ─── Documents ────────────────────────────────────────────
    listDocuments: builder.query({
      query: (params) => ({
        url: `${AI_URL}/documents`,
        method: "GET",
        params: params || {},
      }),
      providesTags: ["DocumentList"],
    }),
    getDocument: builder.query({
      query: (id) => ({
        url: `${AI_URL}/documents/${id}`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Document", id }],
    }),
    updateDocument: builder.mutation({
      query: ({ id, ...data }) => ({
        url: `${AI_URL}/documents/${id}`,
        method: "PUT",
        body: data,
      }),
      invalidatesTags: (result, error, { id }) => [
        { type: "Document", id },
        "DocumentList",
      ],
    }),
    deleteDocument: builder.mutation({
      query: (id) => ({
        url: `${AI_URL}/documents/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["DocumentList"],
    }),

    // ─── Direct generators (documents + presentations) ────────
    generateDocument: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/generate/document`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["DocumentList"],
    }),
    generatePresentation: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/generate/presentation`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["DocumentList"],
    }),

    // ─── Clips (Groq-only pipeline) ───────────────────────────
    listClipJobs: builder.query({
      query: () => ({
        url: `${AI_URL}/clips`,
        method: "GET",
      }),
      providesTags: ["ClipList"],
    }),
    getClipJob: builder.query({
      query: (id) => ({
        url: `${AI_URL}/clips/${id}`,
        method: "GET",
      }),
      providesTags: (result, error, id) => [{ type: "Clip", id }],
    }),
    startClipJob: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/clips`,
        method: "POST",
        body: data,
      }),
      invalidatesTags: ["ClipList"],
    }),

    // ─── Tools ────────────────────────────────────────────────
    searchWeb: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/tools/search`,
        method: "POST",
        body: data,
      }),
    }),
    analyzeWebsite: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/tools/website`,
        method: "POST",
        body: data,
      }),
    }),
    analyzeImage: builder.mutation({
      query: (data) => ({
        url: `${AI_URL}/analyze/image`,
        method: "POST",
        body: data,
      }),
    }),

    // ─── Diagnostics ──────────────────────────────────────────
    getResolvedModels: builder.query({
      query: () => ({
        url: `${AI_URL}/models`,
        method: "GET",
      }),
    }),
  }),
});

// ✅ All hooks exported
export const {
  // Uploads
  useUploadAttachmentMutation,
  useUploadImageMutation,

  // Chat
  useSendMessageMutation,

  // Conversations
  useListConversationsQuery,
  useGetConversationQuery,
  useCreateConversationMutation,
  useUpdateConversationMutation,
  useDeleteConversationMutation,

  // Documents
  useListDocumentsQuery,
  useGetDocumentQuery,
  useUpdateDocumentMutation,
  useDeleteDocumentMutation,

  // Direct generators
  useGenerateDocumentMutation,
  useGeneratePresentationMutation,

  // Clips
  useListClipJobsQuery,
  useGetClipJobQuery,
  useStartClipJobMutation,

  // Tools
  useSearchWebMutation,
  useAnalyzeWebsiteMutation,
  useAnalyzeImageMutation,

  // Diagnostics
  useGetResolvedModelsQuery,
} = aiApiSlice;