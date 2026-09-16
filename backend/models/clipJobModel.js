// models/clipJobModel.js
import mongoose from "mongoose";

const clipSchema = new mongoose.Schema(
  {
    url: { type: String, default: "" },
    duration: { type: Number, default: 0 },
    startTime: { type: Number, default: 0 },
    endTime: { type: Number, default: 0 },
    title: { type: String, default: "" },
    hook: { type: String, default: "" },
    viralityScore: { type: Number, default: 0 },
    thumbnail: { type: String, default: "" },
    aspectRatio: { type: String, default: "portrait" },
  },
  { _id: true }
);

const clipJobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },

    sourceUrl: { type: String, required: true },
    sourceTitle: { type: String, default: "" },
    prompt: { type: String, default: "", maxlength: 500 },

    // "groq" | "heygen" | "makeaiclips"
    provider: { type: String, default: "groq" },

    status: {
      type: String,
      enum: ["queued", "downloading", "transcribing", "analyzing", "clipping", "ready", "failed"],
      default: "queued",
    },
    failureReason: { type: String, default: "" },

    requestedClips: { type: Number, default: 7 },
    aspectRatio: { type: String, default: "portrait" },

    transcript: { type: String, default: "" },       // full Whisper output
    transcriptSegments: { type: mongoose.Schema.Types.Mixed, default: [] },

    clips: { type: [clipSchema], default: [] },
    summary: { type: String, default: "" },
  },
  { timestamps: true }
);

clipJobSchema.index({ user: 1, createdAt: -1 });

clipJobSchema.methods.toSummary = function () {
  return {
    _id: this._id,
    sourceUrl: this.sourceUrl,
    sourceTitle: this.sourceTitle,
    provider: this.provider,
    status: this.status,
    clipCount: this.clips?.length || 0,
    requestedClips: this.requestedClips,
    createdAt: this.createdAt,
  };
};

const ClipJob = mongoose.model("ClipJob", clipJobSchema);
export default ClipJob;