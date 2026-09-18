// controllers/userController.js
import asyncHandler from "express-async-handler";
import { OAuth2Client } from "google-auth-library";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import { sendOtpEmail } from "../utils/resendOTP.js";
import { claimPendingCollaborations } from "../utils/claimInvites.js";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Helpers ──────────────────────────────────────────────────
const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const getOtpExpiry = () => new Date(Date.now() + 10 * 60 * 1000);

// Normalizes a school name coming in from the client.
const normalizeSchool = (value = "") => value.trim().toLowerCase();

// ─── Shared auth response shape ──────────────────────────────
// Every auth entry point returns the same fields so the frontend
// can render role-aware UI (student vs cyber cafe vs admin)
// without an extra profile fetch.
//
// `extra` carries anything that only some endpoints return — e.g.
// `claimedInvites` from the collaborator claim pass.
const buildAuthResponse = (user, token, extra = {}) => ({
  _id: user._id,
  name: user.name,
  username: user.username,
  email: user.email,
  profile: user.profile,
  profilePhoto: user.profilePhoto,
  authMethod: user.authMethod,
  role: user.role || "user",
  isStudent: user.isStudent || false,
  school: user.school || "",
  cyberCafeStatus: user.cyberCafeStatus || "none",
  token,
  ...extra,
});

// ─── Google Auth ──────────────────────────────────────────────
const getUserInfoFromAccessToken = async (accessToken) => {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch user info from Google");
  }

  return response.json();
};

const googleAuth = asyncHandler(async (req, res) => {
  const { token: googleToken } = req.body;

  if (!googleToken) {
    res.status(400);
    throw new Error("Google token is required");
  }

  let googleId, email, name, picture;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    googleId = payload.sub;
    email = payload.email;
    name = payload.name;
    picture = payload.picture;
  } catch (err) {
    const userInfo = await getUserInfoFromAccessToken(googleToken);
    googleId = userInfo.sub || `google-${userInfo.email}`;
    email = userInfo.email;
    name = userInfo.name;
    picture = userInfo.picture;
  }

  let user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (!user) {
    const baseUsername = (email?.split("@")[0] || name || "user")
      .toLowerCase()
      .replace(/\s+/g, "");

    let username = baseUsername;
    let counter = 1;

    while (await User.findOne({ username })) {
      username = `${baseUsername}${counter++}`;
    }

    user = await User.create({
      googleId,
      name: name || "",
      username,
      email,
      profile: picture || "",
      password: `google-auth-${googleId}`,
      isVerified: true,
      authMethod: "google",
      role: "user",
    });
  } else if (!user.googleId) {
    user.googleId = googleId;
    user.isVerified = true;
    await user.save();
  }

  // Any pending collaborator invites for this email get promoted to
  // real collaborators now, before we hand back the session.
  const claimed = await claimPendingCollaborations(user);

  const token = generateToken(res, user._id);

  res.status(200).json(
    buildAuthResponse(user, token, { claimedInvites: claimed.forms })
  );
});

// ─── Register ─────────────────────────────────────────────────
const registerUser = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    name,
    username,
    isStudent = false,
    school = "",
  } = req.body;

  if (!email || !password || !name) {
    res.status(400);
    throw new Error("Please provide email, password, and name");
  }

  if (password.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  // Students must declare the school they attend.
  if (isStudent && !school.trim()) {
    res.status(400);
    throw new Error("School is required for student accounts");
  }

  const existingUser = await User.findOne({ email });

  if (existingUser && existingUser.isVerified) {
    res.status(400);
    throw new Error("User already exists with this email");
  }

  if (existingUser && !existingUser.isVerified) {
    await User.deleteOne({ _id: existingUser._id });
    console.log(
      `🗑️ Deleted unverified user: ${email} (ID: ${existingUser._id})`
    );
  }

  let finalUsername = username;
  if (!finalUsername) {
    const base = email.split("@")[0].toLowerCase().replace(/\s+/g, "");
    let candidate = base;
    let counter = 1;
    while (await User.findOne({ username: candidate })) {
      candidate = `${base}${counter++}`;
    }
    finalUsername = candidate;
  } else {
    const existing = await User.findOne({ username: finalUsername });
    if (existing) {
      res.status(400);
      throw new Error("Username already taken");
    }
  }

  const otp = generateOtp();
  const otpExpires = getOtpExpiry();

  const user = await User.create({
    email,
    password,
    name,
    username: finalUsername,
    isStudent: Boolean(isStudent),
    school: normalizeSchool(school),
    isVerified: false,
    authMethod: "email",
    role: "user",
    otp,
    otpExpires,
    deleteAfter: new Date(Date.now() + 6 * 60 * 1000),
  });

  await sendOtpEmail(email, otp);

  res.status(201).json({
    message: "User registered. Please verify your email with the OTP sent.",
    email: user.email,
  });
});

// ─── Verify OTP ───────────────────────────────────────────────
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    res.status(400);
    throw new Error("Email and OTP are required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.isVerified) {
    res.status(400);
    throw new Error("User already verified");
  }

  if (user.otp !== otp || user.otpExpires < new Date()) {
    res.status(400);
    throw new Error("Invalid or expired OTP");
  }

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  user.deleteAfter = null;
  await user.save();

  // This is the moment an invited-but-unregistered person officially
  // exists in Xamut. Any pending collaborator invites aimed at this
  // email become real collaborations now.
  const claimed = await claimPendingCollaborations(user);

  const token = generateToken(res, user._id);

  res.status(200).json(
    buildAuthResponse(user, token, { claimedInvites: claimed.forms })
  );
});

// ─── Resend OTP ───────────────────────────────────────────────
const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.isVerified) {
    res.status(400);
    throw new Error("User already verified");
  }

  const otp = generateOtp();
  const otpExpires = getOtpExpiry();

  user.otp = otp;
  user.otpExpires = otpExpires;
  user.deleteAfter = new Date(Date.now() + 6 * 60 * 1000);
  await user.save();

  await sendOtpEmail(email, otp);

  res.status(200).json({ message: "New OTP sent to your email" });
});

// ─── Login ─────────────────────────────────────────────────────
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  if (!user.isVerified && user.authMethod === "email") {
    res.status(401);
    throw new Error(
      "Please verify your email first. Check OTP or request a new one."
    );
  }

  if (user.authMethod === "email") {
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      res.status(401);
      throw new Error("Invalid email or password");
    }
  } else {
    res.status(400);
    throw new Error(
      "This account uses Google Sign-In. Please use Google login."
    );
  }

  // Catch invites that arrived while this person was away. This
  // handles the case where they signed up before the invite was
  // sent — the row is still sitting in pendingCollaborators, and
  // their next login is what promotes it.
  const claimed = await claimPendingCollaborations(user);

  const token = generateToken(res, user._id);

  res.status(200).json(
    buildAuthResponse(user, token, { claimedInvites: claimed.forms })
  );
});

// ─── Forgot Password ──────────────────────────────────────────
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(200).json({
      message: "If that email exists, an OTP has been sent.",
    });
  }

  const resetOtp = generateOtp();
  const resetOtpExpires = getOtpExpiry();

  user.resetOtp = resetOtp;
  user.resetOtpExpires = resetOtpExpires;
  await user.save();

  await sendOtpEmail(email, resetOtp, "Password Reset OTP");

  res.status(200).json({
    message: "If that email exists, an OTP has been sent.",
  });
});

// ─── Reset Password ───────────────────────────────────────────
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    res.status(400);
    throw new Error("Email, OTP, and new password are required");
  }

  if (newPassword.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.resetOtp !== otp || user.resetOtpExpires < new Date()) {
    res.status(400);
    throw new Error("Invalid or expired OTP");
  }

  user.password = newPassword;
  user.resetOtp = undefined;
  user.resetOtpExpires = undefined;
  await user.save();

  res.status(200).json({ message: "Password reset successfully" });
});

// ─── Get Profile ──────────────────────────────────────────────
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "-password -otp -otpExpires -resetOtp -resetOtpExpires -deleteAfter"
  );

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json(user);
});

// ─── Update Profile ────────────────────────────────────────────
const updateProfile = asyncHandler(async (req, res) => {
  const { name, username, profilePhoto, isStudent, school } = req.body;
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (name) user.name = name;

  if (username) {
    const existing = await User.findOne({
      username,
      _id: { $ne: user._id },
    });
    if (existing) {
      res.status(400);
      throw new Error("Username already taken");
    }
    user.username = username;
  }

  // Only normal users / students can toggle the student flag.
  // Cyber cafes and admins keep it false.
  if (typeof isStudent === "boolean" && user.role === "user") {
    if (isStudent && !(school ?? user.school)?.trim()) {
      res.status(400);
      throw new Error("School is required for student accounts");
    }
    user.isStudent = isStudent;
  }

  if (typeof school === "string") {
    // Students and cyber cafes both store a school here.
    if (user.role === "user" || user.role === "cyber_cafe") {
      user.school = normalizeSchool(school);
    }
  }

  if (profilePhoto) {
    if (!profilePhoto.startsWith("data:image/")) {
      res.status(400);
      throw new Error("Invalid image format. Please provide a valid image.");
    }
    const base64Data = profilePhoto.split(",")[1];
    if (!base64Data) {
      res.status(400);
      throw new Error("Invalid image data format");
    }
    const sizeInBytes = Buffer.byteLength(base64Data, "base64");
    if (sizeInBytes > 5 * 1024 * 1024) {
      res.status(400);
      throw new Error("Image size exceeds 5MB limit");
    }
    user.profilePhoto = profilePhoto;
  }

  await user.save();

  const updatedUser = user.toObject();
  delete updatedUser.password;
  delete updatedUser.otp;
  delete updatedUser.otpExpires;
  delete updatedUser.resetOtp;
  delete updatedUser.resetOtpExpires;
  delete updatedUser.deleteAfter;

  res.status(200).json(updatedUser);
});

// ─── Change Password ──────────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user.authMethod === "google") {
    res.status(400);
    throw new Error(
      "Google accounts use Google Sign-In. Password cannot be changed here."
    );
  }

  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    res.status(401);
    throw new Error("Current password is incorrect");
  }

  if (newPassword.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  user.password = newPassword;
  await user.save();

  res.json({ message: "Password updated successfully" });
});

// ─── Upload Profile Photo ─────────────────────────────────────
const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No image file uploaded");
  }

  const imageUrl = req.file.path || req.file.location;

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.profilePhoto = imageUrl;
  await user.save();

  res.status(200).json({
    message: "Profile photo updated successfully",
    profilePhoto: user.profilePhoto,
  });
});

// ─── Delete Account ───────────────────────────────────────────
const deleteAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  await user.deleteOne();

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });

  res.json({ message: "Account deleted successfully" });
});

// ─── Logout ───────────────────────────────────────────────────
const logoutUser = asyncHandler(async (req, res) => {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });

  res.status(200).json({ message: "Logged out successfully" });
});

// ─── Exports ──────────────────────────────────────────────────
export {
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
};