// slices/whatsappApiSlice.js
import { apiSlice } from "./apiSlice.js";

const WA_URL = "/whatsapp";

export const whatsappApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ─────────────────────────────────────────────────────────
    // CONNECTION
    //
    // The connect flow is:
    //   1. POST /connect/start    → backend creates a Twilio
    //                               subaccount and returns the Meta
    //                               Embedded Signup config.
    //   2. Frontend opens Meta's popup with that config, user
    //      completes it, frontend receives { code, wabaId,
    //      phoneNumberId, businessId }.
    //   3. POST /connect/callback → backend hands the payload to
    //                               Twilio, sender gets attached.
    // ─────────────────────────────────────────────────────────
    startWhatsappConnect: builder.mutation({
      query: () => ({
        url: `${WA_URL}/connect/start`,
        method: "POST",
      }),
    }),

    completeWhatsappConnect: builder.mutation({
      query: ({ code, wabaId, phoneNumberId, businessId, displayName }) => ({
        url: `${WA_URL}/connect/callback`,
        method: "POST",
        body: { code, wabaId, phoneNumberId, businessId, displayName },
      }),
      invalidatesTags: ["WhatsappConnection"],
    }),

    getWhatsappConnection: builder.query({
      query: () => ({
        url: `${WA_URL}/connection`,
        method: "GET",
      }),
      providesTags: ["WhatsappConnection"],
    }),

    disconnectWhatsapp: builder.mutation({
      query: () => ({
        url: `${WA_URL}/connection`,
        method: "DELETE",
      }),
      invalidatesTags: [
        "WhatsappConnection",
        "WhatsappConversationList",
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // MESSAGES — SEND
    //
    // Sending invalidates the thread it belongs to and the inbox
    // list, so both the conversation view and the sidebar update
    // without a manual refetch.
    //
    // `conversationId` is optional on the request. If omitted (new
    // contact, first outbound message) we still invalidate the
    // whole conversation list — the backend creates the thread.
    // ─────────────────────────────────────────────────────────
    sendWhatsappMessage: builder.mutation({
      query: ({ to, body, mediaUrls, templateSid }) => ({
        url: `${WA_URL}/messages/send`,
        method: "POST",
        body: { to, body, mediaUrls, templateSid },
      }),
      invalidatesTags: (result, error, { conversationId }) => [
        "WhatsappConversationList",
        ...(conversationId
          ? [{ type: "WhatsappMessages", id: conversationId }]
          : []),
      ],
    }),

    // ─────────────────────────────────────────────────────────
    // INBOX — conversations list
    // ─────────────────────────────────────────────────────────
    listWhatsappConversations: builder.query({
      query: ({ page = 1, limit = 50 } = {}) => ({
        url: `${WA_URL}/conversations`,
        method: "GET",
        params: { page, limit },
      }),
      providesTags: ["WhatsappConversationList"],
    }),

    // ─────────────────────────────────────────────────────────
    // INBOX — messages for one conversation
    //
    // The GET also marks the thread as read on the server, so
    // after a fetch we invalidate the conversation list to make
    // the unread badge drop.
    // ─────────────────────────────────────────────────────────
    listWhatsappMessages: builder.query({
      query: ({ conversationId, page = 1, limit = 100 }) => ({
        url: `${WA_URL}/conversations/${conversationId}/messages`,
        method: "GET",
        params: { page, limit },
      }),
      providesTags: (result, error, { conversationId }) => [
        { type: "WhatsappMessages", id: conversationId },
      ],
      // Fires alongside the query resolution; cheap way to keep the
      // sidebar badge in sync when a thread is opened.
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(
            whatsappApiSlice.util.invalidateTags([
              "WhatsappConversationList",
            ])
          );
        } catch {
          /* thread didn't load — nothing to invalidate */
        }
      },
    }),

    // ─────────────────────────────────────────────────────────
    // TEMPLATES — approved WhatsApp content templates
    // ─────────────────────────────────────────────────────────
    listWhatsappTemplates: builder.query({
      query: () => ({
        url: `${WA_URL}/templates`,
        method: "GET",
      }),
      providesTags: ["WhatsappTemplates"],
    }),
  }),
});

// ─────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────
export const {
  // Connection
  useStartWhatsappConnectMutation,
  useCompleteWhatsappConnectMutation,
  useGetWhatsappConnectionQuery,
  useDisconnectWhatsappMutation,

  // Messages
  useSendWhatsappMessageMutation,

  // Inbox
  useListWhatsappConversationsQuery,
  useListWhatsappMessagesQuery,

  // Templates
  useListWhatsappTemplatesQuery,
} = whatsappApiSlice;