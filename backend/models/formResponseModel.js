// models/formResponseModel.js
import mongoose from "mongoose";

const answerSchema = new mongoose.Schema(
  {
    fieldId: { type: String, required: true },
    // Values can be string, number, boolean, array, or null.
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    // Only used for quiz scoring
    score: { type: Number, default: null },
    correct: { type: Boolean, default: null },
  },
  { _id: false }
);

const responseSchema = new mongoose.Schema(
  {
    form: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },

    // Who submitted. For public forms this is just metadata (if
    // collectEmail is on). For private forms this is the invited
    // participant's email.
    respondentEmail: { type: String, default: "", lowercase: true, trim: true },
    respondentName: { type: String, default: "" },
    participantId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    answers: { type: [answerSchema], default: [] },

    // Quiz totals
    totalScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    passed: { type: Boolean, default: null },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: Date.now },

    // Rough duration in seconds, computed client-side and sent in.
    durationSeconds: { type: Number, default: 0 },

    userAgent: { type: String, default: "" },
    ipHash: { type: String, default: "" },
  },
  { timestamps: true }
);

responseSchema.index({ form: 1, submittedAt: -1 });
responseSchema.index({ form: 1, respondentEmail: 1 });
responseSchema.index({ form: 1, participantId: 1 });

const FormResponse = mongoose.model("FormResponse", responseSchema);
export default FormResponse;