import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { protect } from "../middleware/authMiddleware.js";
import {
  googleAuth,
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  changePassword,
  uploadProfilePhoto,
  deleteAccount,
  logoutUser,
} from "../controllers/userController.js";

const router = express.Router();

// ---------- Cloudinary Configuration ----------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Multer storage for Cloudinary – profile photos go to a dedicated folder
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "profile_photos",
    allowed_formats: ["jpg", "png", "jpeg"],
    transformation: [{ width: 500, height: 500, crop: "limit" }], // optional resize
  },
});

const upload = multer({ storage });

// Optional: verify Cloudinary connection
cloudinary.api
  .ping()
  .then(() => console.log("✅ Cloudinary connected successfully"))
  .catch((err) => console.error("❌ Cloudinary connection failed:", err.message));

// =============================================
//             PUBLIC ROUTES
// =============================================

// @route   POST /api/users/register
// @desc    Register a new user (sends OTP)
// @access  Public
router.post("/register", registerUser);

// @route   POST /api/users/verify-otp
// @desc    Verify email with OTP
// @access  Public
router.post("/verify-otp", verifyOtp);

// @route   POST /api/users/resend-otp
// @desc    Resend verification OTP
// @access  Public
router.post("/resend-otp", resendOtp);

// @route   POST /api/users/login
// @desc    Login with email & password
// @access  Public
router.post("/login", loginUser);

// @route   POST /api/users/google
// @desc    Google OAuth login
// @access  Public
router.post("/google", googleAuth);

// @route   POST /api/users/forgot-password
// @desc    Request password reset OTP
// @access  Public
router.post("/forgot-password", forgotPassword);

// @route   POST /api/users/reset-password
// @desc    Reset password using OTP
// @access  Public
router.post("/reset-password", resetPassword);

// @route   POST /api/users/logout
// @desc    Logout user (clears JWT cookie)
// @access  Public (or Protected – either works)
router.post("/logout", logoutUser);

// =============================================
//           PROTECTED ROUTES
// =============================================

// @route   GET  /api/users/profile
// @route   PUT  /api/users/profile
// @desc    Get / Update user profile (name, username)
// @access  Private
router
  .route("/profile")
  .get(protect, getProfile)
  .put(protect, updateProfile);

// @route   POST /api/users/avatar
// @desc    Upload profile photo (uses Cloudinary)
// @access  Private
router.post("/avatar", protect, upload.single("profilePhoto"), uploadProfilePhoto);

// @route   PUT /api/users/change-password
// @desc    Change password (authenticated user)
// @access  Private
router.put("/change-password", protect, changePassword);

// @route   DELETE /api/users/account
// @desc    Delete user account
// @access  Private
router.delete("/account", protect, deleteAccount);

export default router;