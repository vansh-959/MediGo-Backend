const mongoose = require("mongoose");

const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  purpose: { type: String, required: true, enum: ["signup", "login"] },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  sentAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
  pendingSignup: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true, collection: "email_otps" });

emailOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.EmailOtp || mongoose.model("EmailOtp", emailOtpSchema);
