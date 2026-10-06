import mongoose from "mongoose";

const xamutWhatsAppSessionSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, index: true },
    profileName: { type: String, default: "" },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: "" },
    unreadCount: { type: Number, default: 0 },
    isArchived: { type: Boolean, default: false, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("XamutWhatsAppSession", xamutWhatsAppSessionSchema);