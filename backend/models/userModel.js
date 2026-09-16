// models/userModel.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    // ─── Identity ────────────────────────────────────────────
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      match: [
        /^[a-z0-9._]+$/,
        "Username can only contain letters, numbers, dots and underscores",
      ],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
    },

    // ─── Profile ─────────────────────────────────────────────
    // `profile`      → Google avatar URL (set on Google sign-up)
    // `profilePhoto` → uploaded / base64 image set by the user
    profile: {
      type: String,
      default: "",
    },

    profilePhoto: {
      type: String,
      default: "",
    },

    // ─── Auth metadata ───────────────────────────────────────
    authMethod: {
      type: String,
      enum: ["email", "google"],
      default: "email",
    },

    googleId: {
      type: String,
      default: null,
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    // ─── Email verification OTP ──────────────────────────────
    otp: { type: String, default: undefined },
    otpExpires: { type: Date, default: undefined },

    // ─── Password reset OTP ──────────────────────────────────
    resetOtp: { type: String, default: undefined },
    resetOtpExpires: { type: Date, default: undefined },

    // ─── Cleanup for abandoned registrations ─────────────────
    // TTL index removes the doc once this date passes.
    // `null` (verified users) is NOT a Date, so it never expires.
    deleteAfter: {
      type: Date,
      default: null,
    },

    // ─── Roles ───────────────────────────────────────────────
    // user       → student / normal user
    // cyber_cafe → cyber cafe operator (approved via application flow)
    // admin      → platform admin
    role: {
      type: String,
      enum: ["user", "cyber_cafe", "admin"],
      default: "user",
    },

    // ─── Student info ────────────────────────────────────────
    isStudent: {
      type: Boolean,
      default: false,
    },

    // Used by:
    //   • students → the school they attend
    //   • cyber cafes → the school they operate in
    school: {
      type: String,
      default: "",
      trim: true,
    },

    // ─── Cyber cafe application ──────────────────────────────
    // Handled by the cyber cafe controller — kept here so the
    // auth responses can surface status without an extra lookup.
    cyberCafeStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.password;
        delete ret.otp;
        delete ret.otpExpires;
        delete ret.resetOtp;
        delete ret.resetOtpExpires;
        delete ret.deleteAfter;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ─── Indexes ─────────────────────────────────────────────────
// Auto-delete unverified users 6 minutes after registration
userSchema.index({ deleteAfter: 1 }, { expireAfterSeconds: 0 });

// ─── Hooks ───────────────────────────────────────────────────
// Async middleware — Mongoose handles the returned promise.
// Throw to abort; return for the "nothing to do" case.
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ─── Methods ─────────────────────────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User;