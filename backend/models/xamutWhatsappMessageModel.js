import mongoose from "mongoose";

const xamutWhatsAppMessageSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "XamutWhatsAppSession",
      required: true,
      index: true,
    },
    phone: { type: String, required: true, index: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    body: { type: String, default: "" },
    mediaUrls: { type: [String], default: [] },
    mediaTypes: { type: [String], default: [] },
    numMedia: { type: Number, default: 0 },
    twilioSid: { type: String, index: true, sparse: true },
    status: { type: String, default: "" },
    model: { type: String, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("XamutWhatsAppMessage", xamutWhatsAppMessageSchema);