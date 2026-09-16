// utils/resendOTP.js
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOtpEmail = async (email, otp, purpose = "email-verification") => {
  let subject;

  switch (purpose) {
    case "email-verification":
      subject = "Verify your Xamut account";
      break;
    case "login-2fa":
      subject = "Your Xamut login OTP";
      break;
    case "password-reset":
      subject = "Reset your Xamut password";
      break;
    default:
      subject = purpose; // literal subject passed in
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="margin: 0 0 16px; color: #4f46e5;">Xamut</h2>
      <p style="font-size: 15px; line-height: 1.5;">
        Your OTP for <strong>${subject}</strong> is:
      </p>
      <h1 style="letter-spacing: 6px; font-size: 34px; margin: 16px 0; color: #111;">
        ${otp}
      </h1>
      <p style="font-size: 14px; color: #555;">
        This OTP expires in <strong>10 minutes</strong>.
      </p>
      <p style="font-size: 13px; color: #888; margin-top: 24px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: "Xamut <noreply@curriumx.online>", // change to your verified domain
      to: email,
      subject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      throw new Error("Failed to send OTP email");
    }

    return data;
  } catch (err) {
    console.error("Send OTP error:", err.message);
    throw new Error("Could not send OTP");
  }
};

// Also allow default import if any other file uses it
export default sendOtpEmail;