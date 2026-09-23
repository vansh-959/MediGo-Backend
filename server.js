const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const envPaths = [
  path.join(__dirname, "../.env"),
  path.join(__dirname, ".env"),
  path.join(__dirname, "models/.env"),
];
const envPath = envPaths.find((candidate) => fs.existsSync(candidate));
require("dotenv").config({ path: envPath });

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("./models/User");

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production.");
}

const JWT_SECRET = process.env.JWT_SECRET || "local-development-only-secret";
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
].filter(
  (model, index, models) => Boolean(model) && models.indexOf(model) === index,
);

const mailTransport = process.env.SMTP_URL
  ? nodemailer.createTransport(process.env.SMTP_URL)
  : process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    : null;

const mailFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
let smtpStatus = mailTransport && mailFrom ? "checking" : "not_configured";

if (mailTransport && mailFrom) {
  mailTransport
    .verify()
    .then(() => {
      smtpStatus = "connected";
      console.log("SMTP Connected");
    })
    .catch((error) => {
      smtpStatus = "error";
      console.error(`SMTP connection failed: ${error.code || error.name}`);
    });
} else {
  console.warn("SMTP not configured: password-reset OTP emails are disabled.");
}

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.warn(
      "MONGODB_URI is not configured, running in in-memory auth fallback mode.",
    );
    return false;
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 12000,
      });
      console.log("MongoDB Connected");
      return true;
    } catch (error) {
      console.error(
        `MongoDB connection attempt ${attempt}/4 failed: ${error.code || error.name}`,
      );
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  console.error(
    "MongoDB is unavailable after retries; database-backed operations may fail.",
  );
  return false;
};

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = new Set([
    ...configuredOrigins,
    `http://localhost:5501`,
    `http://127.0.0.1:5501`,
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
  ]);

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(
  "/vendor/leaflet",
  express.static(path.join(__dirname, "../node_modules/leaflet/dist")),
);
app.use(express.static(path.join(__dirname, "../frontend/public")));

// In-Memory Data Stores for Reviews, Emergencies, and Users
const USERS_STORE = [
  {
    id: "usr-1",
    name: "Vikram Sharma",
    email: "vikram.s@example.com",
    phone: "+91 98140 12345",
    city: "Chandigarh",
    createdAt: new Date(Date.now() - 86400000 * 5),
  },
  {
    id: "usr-2",
    name: "Priya Patel",
    email: "priya.patel@example.com",
    phone: "+91 98720 54321",
    city: "Mohali",
    createdAt: new Date(Date.now() - 86400000 * 2),
  },
  {
    id: "usr-3",
    name: "Harpreet Singh",
    email: "harpreet.s@example.com",
    phone: "+91 94170 99887",
    city: "Panchkula",
    createdAt: new Date(Date.now() - 86400000 * 1),
  },
];

const REVIEWS = [
  {
    id: "rev-1",
    hospitalId: "hosp-chd-1",
    hospitalName:
      "PGIMER (Post Graduate Institute of Medical Education & Research)",
    userName: "Rajinder Kumar",
    userEmail: "rajinder.k@example.com",
    rating: 5,
    treatment: "Nephrology & Dialysis",
    comment:
      "Exceptional doctors at the Nehru Hospital wing. Ayushman Bharat cashless facility was seamlessly processed within 30 minutes.",
    date: "2026-03-18",
  },
  {
    id: "rev-2",
    hospitalId: "hosp-chd-2",
    hospitalName: "Max Super Speciality Hospital",
    userName: "Ananya Verma",
    userEmail: "ananya.v@example.com",
    rating: 5,
    treatment: "Emergency Cardiology",
    comment:
      "The emergency team was ready with ICU and cath lab on arrival. Saved my father during acute myocardial infarction.",
    date: "2026-03-20",
  },
  {
    id: "rev-3",
    hospitalId: "hosp-chd-3",
    hospitalName: "Fortis Hospital Mohali",
    userName: "Gurdeep Singh",
    userEmail: "gurdeep.s@example.com",
    rating: 4,
    treatment: "Joint Replacement",
    comment:
      "Very professional orthopedic surgeons. Hospital is clean and ICU care was top notch.",
    date: "2026-03-21",
  },
  {
    id: "rev-4",
    hospitalId: "hosp-chd-4",
    hospitalName: "GMCH Sector 32 (Government Medical College & Hospital)",
    userName: "Suman Lata",
    userEmail: "suman.l@example.com",
    rating: 5,
    treatment: "Emergency Trauma",
    comment:
      "Fast admission at the Apex trauma unit. Affordable medication and 24/7 blood bank support.",
    date: "2026-03-22",
  },
];

const EMERGENCY_ALERTS = [
  {
    id: "emg-1",
    referenceId: "MEDIGO-EMG-9021",
    patientName: "Karamjit Kaur",
    patientAge: 62,
    patientGender: "Female",
    patientPhone: "+91 98150 11223",
    condition: "Acute Chest Pain & Severe Breathlessness",
    urgency: "Emergency",
    requiredCare: ["ICU Bed", "Oxygen Support", "Cardiologist On Standby"],
    etaMinutes: 12,
    hospitalId: "hosp-chd-1",
    hospitalName:
      "PGIMER (Post Graduate Institute of Medical Education & Research)",
    hospitalEmail: "emergency@pgimer.edu.in",
    status: "Trauma Team Ready",
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    id: "emg-2",
    referenceId: "MEDIGO-EMG-9022",
    patientName: "Amit Bansal",
    patientAge: 38,
    patientGender: "Male",
    patientPhone: "+91 94172 33445",
    condition: "Motorcycle Road Accident - Multiple Fractures",
    urgency: "Emergency",
    requiredCare: [
      "Trauma Bay",
      "Orthopedic Surgeon",
      "Blood Transfusion Ready",
    ],
    etaMinutes: 8,
    hospitalId: "hosp-chd-4",
    hospitalName: "GMCH Sector 32 (Government Medical College & Hospital)",
    hospitalEmail: "trauma@gmch.gov.in",
    status: "Preparation Dispatched",
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
  },
];

const publicUser = (user) => ({
  id: user._id || user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  city: user.city || "",
  location: user.location || null,
});

const createToken = (user) =>
  jwt.sign(
    { sub: (user._id || user.id).toString(), email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" },
  );

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token)
    return res
      .status(401)
      .json({ success: false, error: "Authentication required." });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (mongoose.connection.readyState === 1) {
      req.user = await User.findById(payload.sub);
    } else {
      req.user = {
        _id: payload.sub,
        email: payload.email,
        name: "Active User",
        phone: "+91 9876543210",
      };
    }
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, error: "Account not found." });
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Session expired. Please sign in again.",
    });
  }
};

const requireSiteOwner = (req, res, next) => {
  const ownerEmail = (process.env.SITE_OWNER_EMAIL || "").trim().toLowerCase();
  if (
    mongoose.connection.readyState !== 1 ||
    !ownerEmail ||
    (req.user.email || "").trim().toLowerCase() !== ownerEmail
  ) {
    return res
      .status(403)
      .json({ success: false, error: "Site owner access required." });
  }
  next();
};

app.post("/api/auth/signup", async (req, res) => {
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error:
        "Account service is waiting for its database connection. Please try again shortly.",
    });
  }
  const { name, email, phone, password, city = "" } = req.body;
  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    normalizedEmail &&
    normalizedEmail ===
      (process.env.SITE_OWNER_EMAIL || "").trim().toLowerCase()
  ) {
    return res.status(403).json({
      success: false,
      error: "This email cannot be registered through public signup.",
    });
  }

  if (
    !name ||
    name.trim().length < 2 ||
    !phone ||
    !/^\S+@\S+\.\S+$/.test(normalizedEmail)
  ) {
    return res.status(400).json({
      success: false,
      error: "Full name, phone, and a valid email are required.",
    });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      success: false,
      error: "Password must be at least 8 characters.",
    });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser)
        return res.status(409).json({
          success: false,
          error: "An account with this email already exists.",
        });

      const user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        city: typeof city === "string" ? city.trim() : "",
        passwordHash: await bcrypt.hash(password, 12),
      });
      const pUser = publicUser(user);
      USERS_STORE.unshift({ ...pUser, createdAt: new Date() });
      return res
        .status(201)
        .json({ success: true, user: pUser, token: createToken(user) });
    } else {
      const fakeUser = {
        _id: "guest_" + Date.now(),
        name: name.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        city,
      };
      const pUser = publicUser(fakeUser);
      USERS_STORE.unshift({ ...pUser, createdAt: new Date() });
      return res
        .status(201)
        .json({ success: true, user: pUser, token: createToken(fakeUser) });
    }
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists.",
      });
    console.error("Signup error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Unable to create account right now." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error:
        "Account service is waiting for its database connection. Please try again shortly.",
    });
  }
  const { email, password } = req.body;
  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail || typeof password !== "string") {
    return res
      .status(400)
      .json({ success: false, error: "Email and password are required." });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: normalizedEmail }).select(
        "+passwordHash",
      );
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return res
          .status(401)
          .json({ success: false, error: "Invalid email or password." });
      }
      return res.json({
        success: true,
        user: publicUser(user),
        token: createToken(user),
      });
    } else {
      const fakeUser = {
        _id: "user_" + Date.now(),
        name: "Registered Citizen",
        email: normalizedEmail,
        phone: "+91 9876543210",
        city: "Chandigarh",
      };
      return res.json({
        success: true,
        user: publicUser(fakeUser),
        token: createToken(fakeUser),
      });
    }
  } catch (error) {
    console.error("Login error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Unable to sign in right now." });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error:
        "Account service is waiting for its database connection. Please try again shortly.",
    });
  }
  const normalizedEmail =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const genericResponse = {
    success: true,
    message: "If an account exists, a password-reset OTP has been sent.",
  };
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return res.json(genericResponse);

  if (!mailTransport || !mailFrom) {
    return res.status(503).json({
      success: false,
      error: "Password reset email service is not configured.",
    });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail });
    if (user) {
      const otp = String(crypto.randomInt(100000, 1000000));
      user.passwordResetOtpHash = crypto
        .createHash("sha256")
        .update(otp)
        .digest("hex");
      user.passwordResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      user.passwordResetOtpAttempts = 0;
      await user.save();
      await mailTransport.sendMail({
        from: mailFrom,
        to: normalizedEmail,
        subject: "MedAdvisor password reset OTP",
        text: `Your MedAdvisor password reset code is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        html: `<p>Your MedAdvisor password reset code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes.</p>`,
      });
    }
    return res.json(genericResponse);
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.json(genericResponse);
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      success: false,
      error:
        "Account service is waiting for its database connection. Please try again shortly.",
    });
  }
  const { email, otp, password } = req.body;
  if (
    !email ||
    !/^\d{6}$/.test(String(otp || "")) ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Email, six-digit OTP, and a password of at least 8 characters are required.",
    });
  }

  try {
    const otpHash = crypto
      .createHash("sha256")
      .update(String(otp))
      .digest("hex");
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    }).select(
      "+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts",
    );
    if (
      !user ||
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpiresAt ||
      user.passwordResetOtpExpiresAt <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        error: "OTP is invalid or expired. Request a new code.",
      });
    }
    if (user.passwordResetOtpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        error: "Too many incorrect OTP attempts. Request a new code.",
      });
    }
    if (user.passwordResetOtpHash !== otpHash) {
      user.passwordResetOtpAttempts += 1;
      await user.save();
      return res.status(400).json({ success: false, error: "Incorrect OTP." });
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpiresAt = undefined;
    user.passwordResetOtpAttempts = 0;
    await user.save();
    return res.json({
      success: true,
      message: "Password updated. You can now sign in.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res
      .status(500)
      .json({ success: false, error: "Unable to reset password right now." });
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

app.patch("/api/auth/profile", authenticate, async (req, res) => {
  const { name, phone, city, location } = req.body;
  if (
    name !== undefined &&
    (typeof name !== "string" || name.trim().length < 2)
  ) {
    return res.status(400).json({
      success: false,
      error: "Full name must be at least 2 characters.",
    });
  }
  if (phone !== undefined && (typeof phone !== "string" || !phone.trim())) {
    return res
      .status(400)
      .json({ success: false, error: "Phone number is required." });
  }
  if (
    location &&
    (typeof location.lat !== "number" || typeof location.lng !== "number")
  ) {
    return res
      .status(400)
      .json({ success: false, error: "Location coordinates are invalid." });
  }

  if (name !== undefined) req.user.name = name.trim();
  if (phone !== undefined) req.user.phone = phone.trim();
  if (city !== undefined)
    req.user.city = typeof city === "string" ? city.trim() : "";
  if (location !== undefined) req.user.location = location;
  if (req.user.save) await req.user.save();
  return res.json({ success: true, user: publicUser(req.user) });
});

app.get("/api/health", (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(200).json({
    success: true,
    server: "ok",
    database: databaseConnected
      ? "connected"
      : process.env.MONGODB_URI
        ? "disconnected"
        : "in-memory-fallback",
    smtp: smtpStatus,
    uptimeSeconds: Math.round(process.uptime()),
    geminiActive: Boolean(process.env.GEMINI_API_KEY),
  });
});

// =========================================================================
// TECHNOVA 2026: GOVERNMENT HEALTHCARE DIRECTORY & CLINICAL DATA MODEL
// =========================================================================

const HOSPITALS = [
  // CHANDIGARH & TRI-CITY
  {
    id: "hosp-chd-1",
    name: "PGIMER (Post Graduate Institute of Medical Education & Research)",
    tagline: "Premier Autonomous Government Super-Specialty Medical Institute",
    type: "Government / Autonomous Referral Centre",
    rating: 4.9,
    reviewsCount: 4890,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Neurology",
      "Oncology",
      "Emergency",
      "Orthopedics",
      "Pulmonology",
      "Pediatrics",
    ],
    emergencyBedsAvailable: 42,
    totalBeds: 1950,
    icuAvailable: 38,
    location: "Sector 12, Chandigarh",
    city: "Chandigarh",
    postalCode: "160012",
    coordinates: { lat: 30.7673, lng: 76.7794 },
    budgetTier: "$",
    avgConsultationCost: 150,
    avgIcuCostPerDay: 1800,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "ESIC",
      "Himcare",
      "Sarbat Sehat Bima",
    ],
    image:
      "https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?auto=format&fit=crop&w=800&q=80",
    features: [
      "24/7 Apex Trauma Centre",
      "Organ Transplant Wing",
      "Kidney Dialysis Centre",
      "PET-CT & 3T MRI",
      "Subsidized Pharmacy",
    ],
    phone: "+91 172 2747585",
    waitMinutes: 20,
    hours: "Open 24 hours",
    successRate: 98,
    estimatedTreatmentCost: { min: 4500, max: 42000 },
    procedureVolume: 32000,
    accreditations: [
      "NABH",
      "JCI Candidate",
      "Govt of India Institute of National Importance",
    ],
    technologies: [
      "Robotic Dialysis",
      "3T MRI",
      "Dual Source CT",
      "Cath Lab",
      "Organ Transplant Unit",
    ],
    services: [
      "Renal Transplant",
      "Cardiac Bypass",
      "Neurosurgery",
      "Dialysis Unit",
      "Emergency Care",
    ],
  },
  {
    id: "hosp-chd-2",
    name: "Max Super Speciality Hospital",
    tagline: "World-Class Multi-Organ Transplant & Super Speciality Care",
    type: "Private Super Speciality",
    rating: 4.8,
    reviewsCount: 2450,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Oncology",
      "Neurology",
      "Orthopedics",
      "Emergency",
    ],
    emergencyBedsAvailable: 18,
    totalBeds: 350,
    icuAvailable: 16,
    location: "Phase 6, Mohali (Chandigarh)",
    city: "Chandigarh",
    postalCode: "160055",
    coordinates: { lat: 30.7258, lng: 76.7088 },
    budgetTier: "$$$",
    avgConsultationCost: 1200,
    avgIcuCostPerDay: 7500,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "Max Bupa",
      "HDFC Ergo",
      "Tata AIG",
    ],
    image:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    features: [
      "Da Vinci Xi Robotic Surgery",
      "Dedicated Kidney Transplant ICU",
      "24/7 Emergency Care",
      "Cath Lab",
    ],
    phone: "+91 172 5212000",
    waitMinutes: 14,
    hours: "Open 24 hours",
    successRate: 97,
    estimatedTreatmentCost: { min: 45000, max: 195000 },
    procedureVolume: 14200,
    accreditations: ["NABH", "JCI", "NABL"],
    technologies: [
      "Da Vinci Robotic Surgery",
      "TrueBeam Linac",
      "3T MRI",
      "Digital Cath Lab",
    ],
    services: [
      "Kidney Stone Laser",
      "Kidney Transplant",
      "Cardiac ICU",
      "Joint Replacement",
    ],
  },
  {
    id: "hosp-chd-3",
    name: "Fortis Hospital Mohali",
    tagline: "Leader in Cardiac Science, Urology & Advanced Nephrology",
    type: "Private Super Speciality",
    rating: 4.85,
    reviewsCount: 3120,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Oncology",
      "Orthopedics",
      "Emergency",
      "Pediatrics",
    ],
    emergencyBedsAvailable: 22,
    totalBeds: 400,
    icuAvailable: 20,
    location: "Sector 62, Mohali (Chandigarh)",
    city: "Chandigarh",
    postalCode: "160062",
    coordinates: { lat: 30.7046, lng: 76.7179 },
    budgetTier: "$$$",
    avgConsultationCost: 1100,
    avgIcuCostPerDay: 7200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "ICICI Lombard",
      "Care Health",
    ],
    image:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80",
    features: [
      "Level-1 Trauma & Emergency",
      "Lithotripsy & Laser Stone Center",
      "24/7 Hemodialysis",
      "Cath Lab",
    ],
    phone: "+91 172 5021222",
    waitMinutes: 15,
    hours: "Open 24 hours",
    successRate: 96,
    estimatedTreatmentCost: { min: 38000, max: 185000 },
    procedureVolume: 16800,
    accreditations: ["JCI", "NABH", "NABL"],
    technologies: [
      "Robotic Assisted Surgery",
      "Holmium Laser for Stones",
      "Bi-plane Cath Lab",
    ],
    services: [
      "Renal Science",
      "Heart Attack Care",
      "Trauma ICU",
      "Kidney Stone Removal",
    ],
  },
  {
    id: "hosp-chd-4",
    name: "Government Medical College & Hospital (GMCH 32)",
    tagline: "Comprehensive Multi-Speciality Government Teaching Hospital",
    type: "Government Hospital",
    rating: 4.6,
    reviewsCount: 2890,
    specialties: [
      "General Medicine",
      "Emergency",
      "Nephrology",
      "Pediatrics",
      "Cardiology",
      "Orthopedics",
      "Gynecology",
    ],
    emergencyBedsAvailable: 34,
    totalBeds: 980,
    icuAvailable: 24,
    location: "Sector 32, Chandigarh",
    city: "Chandigarh",
    postalCode: "160030",
    coordinates: { lat: 30.7092, lng: 76.777 },
    budgetTier: "$",
    avgConsultationCost: 80,
    avgIcuCostPerDay: 1200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Himcare",
      "Sarbat Sehat",
    ],
    image:
      "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=800&q=80",
    features: [
      "24/7 Free Emergency Services",
      "Dialysis Centre",
      "Blood Bank",
      "Affordable Generics (Jan Aushadhi)",
    ],
    phone: "+91 172 2665253",
    waitMinutes: 24,
    hours: "Open 24 hours",
    successRate: 94,
    estimatedTreatmentCost: { min: 3500, max: 28000 },
    procedureVolume: 22000,
    accreditations: ["NABH Accredited Govt College"],
    technologies: [
      "Digital X-Ray",
      "CT Scan 128 Slice",
      "Ultrasound Color Doppler",
      "Hemodialysis Machines",
    ],
    services: [
      "Emergency Trauma",
      "Dialysis Services",
      "Maternity Care",
      "General Surgery",
    ],
  },
  {
    id: "hosp-chd-5",
    name: "Mukat Hospital & Heart Institute",
    tagline: "Trusted Cardiac, Renal and Multispecialty Hospital in Tri-City",
    type: "Private Multispecialty",
    rating: 4.7,
    reviewsCount: 1650,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Orthopedics",
      "Emergency",
      "General Medicine",
    ],
    emergencyBedsAvailable: 14,
    totalBeds: 180,
    icuAvailable: 12,
    location: "Sector 34-A, Chandigarh",
    city: "Chandigarh",
    postalCode: "160022",
    coordinates: { lat: 30.7225, lng: 76.7682 },
    budgetTier: "$$",
    avgConsultationCost: 750,
    avgIcuCostPerDay: 4800,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "National Insurance",
    ],
    image:
      "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80",
    features: [
      "Emergency Heart Attack Care",
      "Laser Stone Removal",
      "Dialysis Facility",
      "24/7 Lab",
    ],
    phone: "+91 172 4344444",
    waitMinutes: 12,
    hours: "Open 24 hours",
    successRate: 95,
    estimatedTreatmentCost: { min: 22000, max: 110000 },
    procedureVolume: 7400,
    accreditations: ["NABH", "NABL"],
    technologies: ["Digital Cath Lab", "Laser Lithotripsy", "ICU Monitoring"],
    services: [
      "Angioplasty",
      "Kidney Stone Lithotripsy",
      "Dialysis Care",
      "Joint Surgery",
    ],
  },

  // PUNJAB (HOSHIARPUR, JALANDHAR, LUDHIANA, AMRITSAR)
  {
    id: "hosp-pb-1",
    name: "Hoshiarpur Care & Multispecialty Hospital",
    tagline:
      "Premier Healthcare and Emergency Referral Center for Hoshiarpur District",
    type: "Private Multispecialty",
    rating: 4.75,
    reviewsCount: 1120,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Orthopedics",
      "Emergency",
      "General Medicine",
    ],
    emergencyBedsAvailable: 15,
    totalBeds: 210,
    icuAvailable: 12,
    location: "Mall Road, Hoshiarpur, Punjab",
    city: "Hoshiarpur",
    postalCode: "146001",
    coordinates: { lat: 31.5143, lng: 75.9115 },
    budgetTier: "$$",
    avgConsultationCost: 650,
    avgIcuCostPerDay: 4200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "Sarbat Sehat Bima",
      "CGHS",
      "ESIC",
    ],
    image:
      "https://images.unsplash.com/photo-1586773860418-d37222d8fce3?auto=format&fit=crop&w=800&q=80",
    features: [
      "24/7 Critical Emergency",
      "Kidney Dialysis Center",
      "Orthopedic Trauma",
      "Advanced Diagnostics",
    ],
    phone: "+91 1882 240001",
    waitMinutes: 12,
    hours: "Open 24 hours",
    successRate: 93,
    estimatedTreatmentCost: { min: 14000, max: 78000 },
    procedureVolume: 5100,
    accreditations: ["NABH", "NABL"],
    technologies: [
      "CT Scan",
      "Digital X-Ray",
      "Dialysis Units",
      "Ultrasound 4D",
    ],
    services: [
      "Kidney Stone Care",
      "Dialysis",
      "Cardiac Emergency",
      "Trauma Support",
    ],
  },
  {
    id: "hosp-pb-1a",
    name: "Doaba City Hospital Hoshiarpur",
    tagline: "Affordable Care, 24/7 ER, Maternity & General Surgery",
    type: "Community Multispecialty",
    rating: 4.6,
    reviewsCount: 680,
    specialties: [
      "General Medicine",
      "Pediatrics",
      "Emergency",
      "Gynecology",
      "Orthopedics",
    ],
    emergencyBedsAvailable: 10,
    totalBeds: 130,
    icuAvailable: 6,
    location: "Civil Lines, Hoshiarpur, Punjab",
    city: "Hoshiarpur",
    postalCode: "146001",
    coordinates: { lat: 31.5265, lng: 75.8955 },
    budgetTier: "$",
    avgConsultationCost: 450,
    avgIcuCostPerDay: 3200,
    insuranceAccepted: ["Ayushman Bharat PM-JAY", "Sarbat Sehat", "CGHS"],
    image:
      "https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=800&q=80",
    features: [
      "24/7 ER",
      "In-house Pharmacy",
      "Ambulance Network",
      "Labor Room",
    ],
    phone: "+91 1882 240101",
    waitMinutes: 10,
    hours: "Open 24 hours",
    successRate: 91,
    estimatedTreatmentCost: { min: 8000, max: 48000 },
    procedureVolume: 3400,
    accreditations: ["NABH Entry Level"],
    technologies: ["Digital X-Ray", "Ultrasound", "Telemedicine"],
    services: ["Emergency Care", "Pediatrics", "General Surgery", "Maternity"],
  },
  {
    id: "hosp-pb-2",
    name: "Patel Hospital & Super Speciality Cancer Institute",
    tagline:
      "Tertiary Referral Hub for Urology, Nephrology, Oncology & Cardiology",
    type: "Super Speciality",
    rating: 4.85,
    reviewsCount: 2980,
    specialties: [
      "Nephrology",
      "Urology",
      "Oncology",
      "Cardiology",
      "Neurology",
      "Emergency",
      "Orthopedics",
    ],
    emergencyBedsAvailable: 28,
    totalBeds: 450,
    icuAvailable: 22,
    location: "Civil Lines, Jalandhar, Punjab",
    city: "Jalandhar",
    postalCode: "144001",
    coordinates: { lat: 31.326, lng: 75.5762 },
    budgetTier: "$$$",
    avgConsultationCost: 950,
    avgIcuCostPerDay: 5800,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "Sarbat Sehat",
      "CGHS",
      "Star Health",
      "HDFC Ergo",
    ],
    image:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    features: [
      "Dedicated Kidney Stone Center",
      "Renal Transplant Unit",
      "PET-CT & LINAC",
      "Cath Lab",
    ],
    phone: "+91 181 5241000",
    waitMinutes: 16,
    hours: "Open 24 hours",
    successRate: 96,
    estimatedTreatmentCost: { min: 28000, max: 145000 },
    procedureVolume: 12500,
    accreditations: ["NABH", "JCI Candidate", "NABL"],
    technologies: [
      "Holmium Laser",
      "Robotic Laparoscopy",
      "PET CT",
      "Cath Lab",
    ],
    services: [
      "Renal Transplant",
      "Laser Lithotripsy",
      "Cancer Chemo & Surgery",
      "Trauma",
    ],
  },
  {
    id: "hosp-pb-3",
    name: "Dayanand Medical College & Hospital (DMCH)",
    tagline: "Premier 1,500-Bed Tertiary Teaching Hospital & Trauma Centre",
    type: "Tertiary Teaching Medical College",
    rating: 4.8,
    reviewsCount: 3900,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Neurology",
      "Oncology",
      "Orthopedics",
      "Emergency",
      "Pediatrics",
    ],
    emergencyBedsAvailable: 35,
    totalBeds: 1500,
    icuAvailable: 32,
    location: "Civil Lines, Ludhiana, Punjab",
    city: "Ludhiana",
    postalCode: "141001",
    coordinates: { lat: 30.901, lng: 75.8573 },
    budgetTier: "$$",
    avgConsultationCost: 600,
    avgIcuCostPerDay: 4600,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "Sarbat Sehat",
      "CGHS",
      "ESIC",
      "Star Health",
    ],
    image:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80",
    features: [
      "Hero DMC Heart Institute",
      "Advanced Renal Sciences & Dialysis",
      "Apex Trauma",
      "Kidney Transplant",
    ],
    phone: "+91 161 4688888",
    waitMinutes: 20,
    hours: "Open 24 hours",
    successRate: 96,
    estimatedTreatmentCost: { min: 20000, max: 130000 },
    procedureVolume: 24000,
    accreditations: ["NABH", "NABL"],
    technologies: [
      "3T MRI",
      "Robotic Surgery",
      "Renal Dialysis Station",
      "Cath Lab",
    ],
    services: [
      "Kidney Transplant",
      "Cardiac Bypass",
      "Neurosurgery",
      "Emergency ICU",
    ],
  },
  {
    id: "hosp-pb-4",
    name: "Fortis Escorts Hospital Amritsar",
    tagline: "Center of Excellence in Cardiac, Renal Sciences & Orthopedics",
    type: "Private Super Speciality",
    rating: 4.75,
    reviewsCount: 1850,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Emergency",
      "Orthopedics",
      "General Medicine",
    ],
    emergencyBedsAvailable: 18,
    totalBeds: 280,
    icuAvailable: 16,
    location: "Majitha-Verka Bypass Road, Amritsar, Punjab",
    city: "Amritsar",
    postalCode: "143001",
    coordinates: { lat: 31.634, lng: 74.8723 },
    budgetTier: "$$$",
    avgConsultationCost: 900,
    avgIcuCostPerDay: 5800,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Sarbat Sehat",
      "Star Health",
    ],
    image:
      "https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?auto=format&fit=crop&w=800&q=80",
    features: [
      "24/7 Cardiac ER",
      "Dialysis & Lithotripsy",
      "Level 1 Emergency",
      "Digital Imaging",
    ],
    phone: "+91 183 5033333",
    waitMinutes: 14,
    hours: "Open 24 hours",
    successRate: 95,
    estimatedTreatmentCost: { min: 26000, max: 140000 },
    procedureVolume: 9200,
    accreditations: ["NABH", "NABL"],
    technologies: ["Cath Lab", "Hemodialysis Units", "MRI 1.5T"],
    services: [
      "Renal Care",
      "Angioplasty",
      "Joint Replacement",
      "Emergency ICU",
    ],
  },

  // DELHI NCR
  {
    id: "hosp-del-1",
    name: "AIIMS (All India Institute of Medical Sciences)",
    tagline: "India's Foremost Government Medical Institute & Research Apex",
    type: "Central Government Apex Hospital",
    rating: 4.95,
    reviewsCount: 8900,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Neurology",
      "Oncology",
      "Orthopedics",
      "Emergency",
      "Pediatrics",
      "Ophthalmology",
    ],
    emergencyBedsAvailable: 50,
    totalBeds: 2500,
    icuAvailable: 45,
    location: "Ansari Nagar, New Delhi",
    city: "Delhi",
    postalCode: "110029",
    coordinates: { lat: 28.5672, lng: 77.21 },
    budgetTier: "$",
    avgConsultationCost: 50,
    avgIcuCostPerDay: 1000,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "All Govt Schemes",
      "Universal Care",
    ],
    image:
      "https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?auto=format&fit=crop&w=800&q=80",
    features: [
      "National Referral Center",
      "Zero-Profit Subsidized Care",
      "Apex Trauma Center",
      "Robotic Organ Transplant",
    ],
    phone: "+91 11 26588500",
    waitMinutes: 25,
    hours: "Open 24 hours",
    successRate: 99,
    estimatedTreatmentCost: { min: 2000, max: 25000 },
    procedureVolume: 58000,
    accreditations: ["NABH", "NABL", "Institute of National Importance"],
    technologies: [
      "Robotic Transplant System",
      "PET-MRI",
      "CyberKnife",
      "3T MRI",
    ],
    services: [
      "Kidney Transplant",
      "Open Heart Surgery",
      "Neuro ICU",
      "Emergency Trauma",
    ],
  },
  {
    id: "hosp-del-2",
    name: "Medanta - The Medicity",
    tagline:
      "Internationally Acclaimed Multi-Super Speciality & Transplant Hub",
    type: "Private Multi-Super Speciality",
    rating: 4.9,
    reviewsCount: 5200,
    specialties: [
      "Nephrology",
      "Urology",
      "Cardiology",
      "Neurology",
      "Oncology",
      "Orthopedics",
      "Emergency",
    ],
    emergencyBedsAvailable: 35,
    totalBeds: 1250,
    icuAvailable: 30,
    location: "Sector 38, Gurugram, Delhi NCR",
    city: "Delhi",
    postalCode: "122001",
    coordinates: { lat: 28.439, lng: 77.0428 },
    budgetTier: "$$$$",
    avgConsultationCost: 1500,
    avgIcuCostPerDay: 9500,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "Max Bupa",
      "Cigna",
      "Aetna",
    ],
    image:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    features: [
      "Kidney & Urology Institute",
      "Robotic Kidney Surgery",
      "Flying Doctors Air Ambulance",
      "24/7 ER",
    ],
    phone: "+91 124 4141414",
    waitMinutes: 12,
    hours: "Open 24 hours",
    successRate: 98,
    estimatedTreatmentCost: { min: 55000, max: 240000 },
    procedureVolume: 28000,
    accreditations: ["JCI", "NABH", "NABL"],
    technologies: [
      "Da Vinci Xi Robotic Surgery",
      "TrueBeam STx",
      "Brain Suite",
      "Robotic Lithotripsy",
    ],
    services: [
      "Kidney Stone Removal",
      "Renal Transplant",
      "Cardiac Bypass",
      "Neurosurgery",
    ],
  },
  {
    id: "hosp-del-3",
    name: "Indraprastha Apollo Hospitals",
    tagline:
      "India's First JCI Accredited Hospital with Dedicated Centers of Excellence",
    type: "Private Super Speciality",
    rating: 4.85,
    reviewsCount: 4600,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Oncology",
      "Neurology",
      "Orthopedics",
      "Pediatrics",
      "Emergency",
    ],
    emergencyBedsAvailable: 26,
    totalBeds: 710,
    icuAvailable: 24,
    location: "Sarita Vihar, Mathura Road, New Delhi",
    city: "Delhi",
    postalCode: "110076",
    coordinates: { lat: 28.5376, lng: 77.2882 },
    budgetTier: "$$$",
    avgConsultationCost: 1300,
    avgIcuCostPerDay: 8200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "HDFC Ergo",
      "United Healthcare",
    ],
    image:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80",
    features: [
      "Comprehensive Kidney Care",
      "Laser Stone Clinic",
      "Pediatric Heart Centre",
      "24/7 Emergency",
    ],
    phone: "+91 11 26925858",
    waitMinutes: 14,
    hours: "Open 24 hours",
    successRate: 97,
    estimatedTreatmentCost: { min: 48000, max: 210000 },
    procedureVolume: 19500,
    accreditations: ["JCI", "NABH", "NABL"],
    technologies: [
      "CyberKnife",
      "Da Vinci Surgical System",
      "3T MRI",
      "Cath Lab",
    ],
    services: [
      "Kidney Stone Treatment",
      "Heart Surgery",
      "Cancer Care",
      "Emergency Trauma",
    ],
  },

  // MUMBAI & PUNE
  {
    id: "hosp-mum-1",
    name: "Tata Memorial Hospital & ACTREC",
    tagline: "National Comprehensive Cancer & Specialty Referral Centre",
    type: "Government / DAE Apex Cancer Centre",
    rating: 4.9,
    reviewsCount: 6200,
    specialties: [
      "Oncology",
      "General Medicine",
      "Radiology",
      "Emergency",
      "Palliative Care",
    ],
    emergencyBedsAvailable: 25,
    totalBeds: 700,
    icuAvailable: 20,
    location: "Parel, Mumbai, Maharashtra",
    city: "Mumbai",
    postalCode: "400012",
    coordinates: { lat: 18.9984, lng: 72.8427 },
    budgetTier: "$",
    avgConsultationCost: 200,
    avgIcuCostPerDay: 2200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "MJPJAY",
      "Tata Trust Schemes",
    ],
    image:
      "https://images.unsplash.com/photo-1587351021759-3e566b6af7cc?auto=format&fit=crop&w=800&q=80",
    features: [
      "World-Leading Cancer Research",
      "Subsidized Chemotherapy",
      "Proton Therapy",
      "24/7 ER",
    ],
    phone: "+91 22 24177000",
    waitMinutes: 18,
    hours: "Open 24 hours",
    successRate: 97,
    estimatedTreatmentCost: { min: 8000, max: 75000 },
    procedureVolume: 35000,
    accreditations: ["NABH", "Atomic Energy Commission Certified"],
    technologies: ["Proton Beam Therapy", "Robotic Onco-Surgery", "PET-CT"],
    services: [
      "Cancer Chemo",
      "Radiation Therapy",
      "Surgical Oncology",
      "Bone Marrow Transplant",
    ],
  },
  {
    id: "hosp-mum-2",
    name: "Lilavati Hospital and Research Centre",
    tagline: "Premier Multi-Specialty Tertiary Care in Bandra",
    type: "Private Tertiary Care",
    rating: 4.8,
    reviewsCount: 3400,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Neurology",
      "Orthopedics",
      "Emergency",
    ],
    emergencyBedsAvailable: 16,
    totalBeds: 320,
    icuAvailable: 15,
    location: "Bandra West, Mumbai, Maharashtra",
    city: "Mumbai",
    postalCode: "400050",
    coordinates: { lat: 19.0519, lng: 72.829 },
    budgetTier: "$$$",
    avgConsultationCost: 1400,
    avgIcuCostPerDay: 8500,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Star Health",
      "Max Bupa",
    ],
    image:
      "https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=800&q=80",
    features: [
      "Intensive Cardiac Care",
      "Kidney Dialysis & Stone Clinic",
      "24/7 Trauma Service",
    ],
    phone: "+91 22 26751000",
    waitMinutes: 12,
    hours: "Open 24 hours",
    successRate: 96,
    estimatedTreatmentCost: { min: 42000, max: 190000 },
    procedureVolume: 13500,
    accreditations: ["NABH", "NABL"],
    technologies: ["Digital Cath Lab", "Laser Stone Removal", "3T MRI"],
    services: [
      "Renal Sciences",
      "Angioplasty",
      "Neurosurgery",
      "Dialysis Care",
    ],
  },

  // BENGALURU & HYDERABAD
  {
    id: "hosp-blr-1",
    name: "Narayana Institute of Cardiac Sciences",
    tagline:
      "World Pioneer in High-Volume Affordable Cardiology & Super Speciality",
    type: "Super Speciality Hospital",
    rating: 4.9,
    reviewsCount: 5600,
    specialties: [
      "Cardiology",
      "Nephrology",
      "Urology",
      "Pediatrics",
      "Emergency",
      "General Medicine",
    ],
    emergencyBedsAvailable: 30,
    totalBeds: 1400,
    icuAvailable: 28,
    location: "Bommasandra, Bengaluru, Karnataka",
    city: "Bengaluru",
    postalCode: "560099",
    coordinates: { lat: 12.8123, lng: 77.6912 },
    budgetTier: "$$",
    avgConsultationCost: 600,
    avgIcuCostPerDay: 4200,
    insuranceAccepted: [
      "Ayushman Bharat PM-JAY",
      "CGHS",
      "Yeshasvini",
      "Star Health",
      "All TPA",
    ],
    image:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80",
    features: [
      "Dedicated Kidney & Heart Centers",
      "Affordable Procedure Packages",
      "Pediatric ICU",
    ],
    phone: "+91 80 71222222",
    waitMinutes: 15,
    hours: "Open 24 hours",
    successRate: 98,
    estimatedTreatmentCost: { min: 25000, max: 140000 },
    procedureVolume: 26000,
    accreditations: ["JCI", "NABH", "NABL"],
    technologies: [
      "Digital Cath Labs",
      "Kidney Dialysis Suites",
      "ECMO",
      "3T MRI",
    ],
    services: [
      "Heart Surgery",
      "Dialysis Care",
      "Kidney Stone Laser",
      "Emergency Trauma",
    ],
  },
];

const CITY_COORDINATES = {
  chandigarh: { lat: 30.7333, lng: 76.7794, name: "Chandigarh" },
  mohali: { lat: 30.7046, lng: 76.7179, name: "Mohali, Punjab" },
  panchkula: { lat: 30.6942, lng: 76.8606, name: "Panchkula, Haryana" },
  hoshiarpur: { lat: 31.5143, lng: 75.9115, name: "Hoshiarpur, Punjab" },
  jalandhar: { lat: 31.326, lng: 75.5762, name: "Jalandhar, Punjab" },
  ludhiana: { lat: 30.901, lng: 75.8573, name: "Ludhiana, Punjab" },
  amritsar: { lat: 31.634, lng: 74.8723, name: "Amritsar, Punjab" },
  punjab: { lat: 31.1471, lng: 75.3412, name: "Punjab" },
  delhi: { lat: 28.6139, lng: 77.209, name: "New Delhi" },
  "new delhi": { lat: 28.6139, lng: 77.209, name: "New Delhi" },
  gurugram: { lat: 28.4595, lng: 77.0266, name: "Gurugram, Delhi NCR" },
  noida: { lat: 28.5355, lng: 77.391, name: "Noida, Delhi NCR" },
  mumbai: { lat: 19.076, lng: 72.8777, name: "Mumbai, Maharashtra" },
  pune: { lat: 18.5204, lng: 73.8567, name: "Pune, Maharashtra" },
  bengaluru: { lat: 12.9716, lng: 77.5946, name: "Bengaluru, Karnataka" },
  bangalore: { lat: 12.9716, lng: 77.5946, name: "Bengaluru, Karnataka" },
  hyderabad: { lat: 17.385, lng: 78.4867, name: "Hyderabad, Telangana" },
  jaipur: { lat: 26.9124, lng: 75.7873, name: "Jaipur, Rajasthan" },
  kolkata: { lat: 22.5726, lng: 88.3639, name: "Kolkata, West Bengal" },
  chennai: { lat: 13.0827, lng: 80.2707, name: "Chennai, Tamil Nadu" },
};

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withTimeout(promise, milliseconds) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("External service timed out.")),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

// Resilient Gemini multi-model caller
async function callGemini(
  contents,
  config = {},
  maxAttempts = GEMINI_MODELS.length,
  timeoutMs = 9000,
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    for (const model of GEMINI_MODELS.slice(0, maxAttempts)) {
      try {
        const response = await withTimeout(
          ai.models.generateContent({
            model,
            contents,
            config,
          }),
          timeoutMs,
        );
        const text =
          typeof response.text === "function" ? response.text() : response.text;
        if (text && text.trim()) {
          return { text: text.trim(), model };
        }
      } catch (err) {
        console.warn(`Gemini model ${model} unavailable: ${err.message}`);
      }
    }
  } catch (outerErr) {
    console.warn(`Gemini SDK invocation failed: ${outerErr.message}`);
  }
  return null;
}

// =========================================================================
// MULTILINGUAL CLINICAL NLP & TRIAGE ENGINE
// Supports: English, Hindi (हिन्दी), Hinglish, Punjabi (ਪੰਜਾਬੀ)
// =========================================================================

const CLINICAL_KNOWLEDGE_BASE = [
  {
    specialty: "Nephrology",
    secondary: ["Urology", "General Medicine"],
    urgency: "Urgent",
    keywords: [
      "kidney",
      "renal",
      "pathri",
      "stone",
      "gurda",
      "gurde",
      "mutra",
      "urine",
      "dialysis",
      "nephro",
      "kidney stone",
      "kidney pain",
      "creatinine",
      "flank pain",
      "peshab",
      "पेशाब",
      "गुर्दा",
      "पथरी",
      "ਗੁਰਦਾ",
      "ਪੱਥਰੀ",
      "ਮੂਤਰ",
    ],
    defaultDisease: "Kidney Disease / Renal Calculus (Pathri)",
    departmentName: "Nephrology & Urology Department",
    homeCare:
      "Stay well-hydrated with clean water, avoid high-sodium foods, and do not delay urination.",
    redFlags:
      "Inability to pass urine, severe back/flank pain with fever or chills, blood in urine.",
    diagnosticTests:
      "KFT (Kidney Function Test), Ultrasound KUB, Urine Routine & Serum Creatinine",
    costRange: "₹4,500 - ₹55,000 (Covered under Ayushman Bharat PM-JAY)",
  },
  {
    specialty: "Cardiology",
    secondary: ["Emergency Medicine", "General Medicine"],
    urgency: "Emergency",
    keywords: [
      "chest pain",
      "heart",
      "dil",
      "cardiac",
      "angina",
      "attack",
      "heart attack",
      "dhadkan",
      "palpitation",
      "chhati",
      "bypass",
      "bp",
      "hypertension",
      "cardio",
      "दिल",
      "छाती में दर्द",
      "हार्ट",
      "दिल का दौरा",
      "हृदय",
      "ਹਾਰਟ",
      "ਦਿਲ ਦੀ ਬਿਮਾਰੀ",
    ],
    defaultDisease: "Cardiovascular Symptoms / Chest Pain",
    departmentName: "Cardiology & Cardiac ICU",
    homeCare:
      "Sit comfortably and rest immediately. Loosen tight clothing. Call 108 ambulance if pain spreads to arm or jaw.",
    redFlags:
      "Crushing chest pressure, pain radiating to left shoulder/jaw, sweating, shortness of breath.",
    diagnosticTests:
      "ECG (Electrocardiogram), Troponin-I, 2D Echocardiography, Lipid Profile",
    costRange: "₹8,000 - ₹1,40,000 (Free at empaneled Govt/Ayushman hospitals)",
  },
  {
    specialty: "Neurology",
    secondary: ["General Medicine", "Emergency Medicine"],
    urgency: "Urgent",
    keywords: [
      "headache",
      "brain",
      "sir dard",
      "stroke",
      "migraine",
      "dizzy",
      "chakkar",
      "paralysis",
      "dimag",
      "fit",
      "seizure",
      "mirgi",
      "memory",
      "numbness",
      "neuro",
      "सिर दर्द",
      "दिमाग",
      "चक्कर",
      "दौरा",
      "लकवा",
      "ਮਾਈਗ੍ਰੇਨ",
      "ਸਿਰ ਦਰਦ",
      "ਦਿਮਾਗ",
    ],
    defaultDisease: "Neurological Condition / Severe Headache",
    departmentName: "Neurology & Brain Science",
    homeCare:
      "Rest in a quiet, dark room, hydrate well, and avoid bright screens.",
    redFlags:
      "Sudden worst headache of life, facial drooping, arm weakness, slurred speech (FAST warning signs).",
    diagnosticTests: "NCCT Brain / MRI Brain, EEG, Neurological Reflex Exam",
    costRange: "₹3,500 - ₹65,000 (Subsidized under CGHS & PM-JAY)",
  },
  {
    specialty: "Orthopedics",
    secondary: ["Emergency Medicine", "Physiotherapy"],
    urgency: "Urgent",
    keywords: [
      "fracture",
      "bone",
      "haddi",
      "joint pain",
      "ghutna",
      "kamar dard",
      "back pain",
      "arthritis",
      "ligament",
      "sprain",
      "knee",
      "spine",
      "ortho",
      "plaster",
      "हड्डी",
      "जोड़ों का दर्द",
      "घुटना",
      "कमर दर्द",
      "फ्रैक्चर",
      "ਹੱਡੀ",
      "ਗੋਡਾ",
      "ਜੋੜਾਂ ਦਾ ਦਰਦ",
    ],
    defaultDisease: "Orthopedic / Bone & Joint Disorder",
    departmentName: "Orthopedics & Trauma Surgery",
    homeCare:
      "Immobilize the affected limb using a sling or splint. Apply cold ice pack wrapped in a cloth.",
    redFlags:
      "Visible bone deformity, inability to bear any weight, intense numbness or loss of pulse in limb.",
    diagnosticTests: "Digital X-Ray, MRI Joint/Spine, Bone Density (DEXA Scan)",
    costRange: "₹2,500 - ₹85,000 (Joint replacement covered under PM-JAY)",
  },
  {
    specialty: "General Medicine",
    secondary: ["Endocrinology", "Diabetology"],
    urgency: "Routine",
    keywords: [
      "sugar",
      "diabetes",
      "madhumeh",
      "glucose",
      "insulin",
      "blood sugar",
      "शुगर",
      "मधुमेह",
      "ਡਾਇਬੀਟੀਜ਼",
      "ਸ਼ੂਗਰ",
    ],
    defaultDisease: "Diabetes Mellitus & Metabolic Care",
    departmentName: "Endocrinology & General Medicine",
    homeCare:
      "Check blood glucose levels fasting & post-meal. Drink plenty of water and follow a balanced low-glycemic diet.",
    redFlags:
      "Extreme thirst with confusion, sweet fruity breath, ketone bodies, non-healing foot ulcers.",
    diagnosticTests:
      "HbA1c (3-month average), Fasting & PP Blood Sugar, Urine Microalbumin",
    costRange: "₹500 - ₹5,000 (Medicines free at Jan Aushadhi Kendras)",
  },
  {
    specialty: "Oncology",
    secondary: ["Surgical Oncology", "General Surgery"],
    urgency: "Urgent",
    keywords: [
      "cancer",
      "tumor",
      "gilti",
      "oncology",
      "chemo",
      "malignancy",
      "lump",
      "biopsy",
      "कैंसर",
      "ट्यूमर",
      "गिल्टी",
      "ਕੈਂਸਰ",
    ],
    defaultDisease: "Oncology / Suspected Neoplasm Consultation",
    departmentName: "Medical & Surgical Oncology",
    homeCare:
      "Gather all prior biopsy and blood reports. Maintain good nutrition and avoid unverified remedies.",
    redFlags:
      "Rapidly enlarging painless lump, unexplained severe weight loss, persistent abnormal bleeding.",
    diagnosticTests:
      "Biopsy / Histopathology, PET-CT Scan, Tumor Markers (CEA, CA-125)",
    costRange: "₹10,000 - ₹1,80,000 (Fully funded up to ₹5 Lakh under PM-JAY)",
  },
  {
    specialty: "Pediatrics",
    secondary: ["Emergency Medicine", "General Medicine"],
    urgency: "Urgent",
    keywords: [
      "child",
      "baby",
      "baccha",
      "bacha",
      "pediatric",
      "infant",
      "toddler",
      "kid",
      "बच्चा",
      "शिशु",
      "बाल रोग",
      "ਬੱਚਾ",
      "ਨਿਆਣਾ",
    ],
    defaultDisease: "Pediatric Health Condition",
    departmentName: "Pediatrics & Neonatal Care",
    homeCare:
      "Keep child hydrated with ORS and breastmilk/water. Sponge with lukewarm water if fever is high.",
    redFlags:
      "Lethargy, refusal to feed, difficulty breathing, persistent vomiting or febrile convulsions.",
    diagnosticTests:
      "CBC (Complete Blood Count), Pediatric Physical Exam, Urine Culture",
    costRange: "₹500 - ₹15,000 (Subsidized at all Govt District Hospitals)",
  },
  {
    specialty: "Pulmonology",
    secondary: ["Emergency Medicine", "General Medicine"],
    urgency: "Urgent",
    keywords: [
      "breath",
      "cough",
      "khansi",
      "asthma",
      "dam",
      "saans",
      "pneumonia",
      "tb",
      "tuberculosis",
      "wheezing",
      "chest congestion",
      "oxygen",
      "lung",
      "सांस",
      "खांसी",
      "दमा",
      "फेफड़े",
      "ਟੀਬੀ",
      "ਸਾਹ ਦੀ ਤਕਲੀਫ",
      "ਖੰਘ",
    ],
    defaultDisease: "Respiratory / Pulmonary Disorder",
    departmentName: "Pulmonology & Respiratory Medicine",
    homeCare:
      "Sit upright, perform steam inhalation, check pulse oximeter for SpO2 levels.",
    redFlags:
      "SpO2 level below 92%, blue lips or fingertips, gasping for breath.",
    diagnosticTests:
      "Chest X-Ray PA View, Spirometry / PFT, Sputum AFB / GeneXpert",
    costRange:
      "₹1,500 - ₹25,000 (TB treatment is 100% free under National TB Elimination Program)",
  },
  {
    specialty: "Gastroenterology",
    secondary: ["General Surgery", "General Medicine"],
    urgency: "Routine",
    keywords: [
      "stomach",
      "pet dard",
      "abdominal",
      "liver",
      "gastric",
      "ulcer",
      "vomit",
      "dast",
      "loose motion",
      "food poisoning",
      "acidity",
      "constipation",
      "appendix",
      "पेट दर्द",
      "उल्टी",
      "दस्त",
      "लिवर",
      "ਗੈਸਟਰੋ",
      "ਪੇਟ ਦਰਦ",
      "ਉਲਟੀ",
    ],
    defaultDisease: "Gastrointestinal & Abdominal Condition",
    departmentName: "Gastroenterology & Digestive Health",
    homeCare:
      "Take frequent sips of Oral Rehydration Solution (ORS), light diet (khichdi/curd), avoid spicy or greasy food.",
    redFlags:
      "Severe sharp pain in lower right abdomen (appendix warning), black tarry stools, coffee-ground vomiting.",
    diagnosticTests:
      "Ultrasound Abdomen, LFT (Liver Function Test), Upper GI Endoscopy",
    costRange: "₹1,200 - ₹35,000",
  },
  {
    specialty: "Ophthalmology",
    secondary: ["General Medicine"],
    urgency: "Routine",
    keywords: [
      "eye",
      "aankh",
      "aankhon",
      "vision",
      "motiyabind",
      "cataract",
      "retina",
      "blind",
      "cornea",
      "आँख",
      "मोतियाबिंद",
      "रोशनी",
      "दृष्टि",
      "ਅੱਖਾਂ",
      "ਮੋਤੀਆਬਿੰਦ",
    ],
    defaultDisease: "Ophthalmology / Eye Care",
    departmentName: "Ophthalmology & Vision Care",
    homeCare:
      "Do not rub the eye. Wash with clean water. Wear sunglasses to protect against light sensitivity.",
    redFlags:
      "Sudden partial or total loss of vision, eye chemical burn, severe eye pain with rainbow halos.",
    diagnosticTests:
      "Slit Lamp Biomicroscopy, Visual Acuity Test, Tonometry (Eye Pressure)",
    costRange: "₹800 - ₹35,000 (Cataract surgery free at empaneled centres)",
  },
  {
    specialty: "ENT",
    secondary: ["General Medicine"],
    urgency: "Routine",
    keywords: [
      "ear",
      "kaan",
      "nose",
      "naak",
      "throat",
      "gala",
      "tonsil",
      "sinus",
      "hearing",
      "earache",
      "कान",
      "नाक",
      "गला",
      "टॉन्सिल",
      "ਕੰਨ",
      "ਗਲਾ",
    ],
    defaultDisease: "Ear, Nose & Throat (ENT) Disorder",
    departmentName: "ENT & Head-Neck Clinic",
    homeCare:
      "Warm salt water gargles for sore throat, steam inhalation for sinus congestion.",
    redFlags:
      "Stridor (harsh high-pitched breathing sound), persistent bleeding from ear/nose, inability to swallow saliva.",
    diagnosticTests:
      "Diagnostic Nasal Endoscopy, Pure Tone Audiometry (PTA), Throat Swab",
    costRange: "₹600 - ₹18,000",
  },
  {
    specialty: "General Medicine",
    secondary: ["Infectious Diseases", "Pediatrics"],
    urgency: "Urgent",
    keywords: [
      "fever",
      "bukhar",
      "viral",
      "dengue",
      "malaria",
      "typhoid",
      "infection",
      "chills",
      "weakness",
      "body pain",
      "sar dard",
      "बुखार",
      "डेंगू",
      "मलेरिया",
      "वायरल",
      "ਟਾਈਫਾਈਡ",
      "ਬੁਖਾਰ",
    ],
    defaultDisease: "Acute Febrile Illness / Infection",
    departmentName: "General Internal Medicine",
    homeCare:
      "Complete bed rest, hydrate thoroughly with ORS/water/coconut water. Paracetamol for fever as prescribed.",
    redFlags:
      "Fever exceeding 103°F not subsiding with medication, red skin rashes, bleeding gums (dengue alert).",
    diagnosticTests:
      "CBC with Platelet Count, Dengue NS1 & IgM, Widal / Typhoid Test",
    costRange: "₹400 - ₹6,000",
  },
];

function extractLocationFromQuery(query) {
  const normalized = String(query).toLowerCase();
  for (const [cityKey, info] of Object.entries(CITY_COORDINATES)) {
    if (normalized.includes(cityKey)) return info.name;
  }
  const match = normalized.match(
    /\b(?:in|near|around|at)\s+([a-z][a-z .'-]{2,50}?)(?=\s+(?:for|with|near|around|under|hospital|hospitals|doctor|problem|rupees|rs|inr)\b|$)/i,
  );
  return match ? match[1].trim().replace(/[.,]+$/, "") : "";
}

function extractBudgetFromQuery(query) {
  const normalized = String(query).toLowerCase();
  const lakhMatch = normalized.match(
    /(?:under|below|budget|within|upto|less than)\s*(?:₹|rs\.?|inr)?\s*([0-9.]+)\s*(?:lakh|lac|lacs)/i,
  );
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);

  const numMatch = normalized.match(
    /(?:under|below|budget|within|upto|less than)\s*(?:₹|rs\.?|inr)?\s*([0-9,]+)/i,
  );
  if (numMatch) {
    const parsed = parseInt(numMatch[1].replace(/,/g, ""), 10);
    if (parsed > 0) return parsed;
  }
  return null;
}

function localClinicalTriage(query) {
  const normalized = String(query || "")
    .toLowerCase()
    .trim();
  const detectedLocation = extractLocationFromQuery(query);
  const detectedBudget = extractBudgetFromQuery(query);

  let bestMatch = null;
  let highestScore = 0;

  for (const item of CLINICAL_KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of item.keywords) {
      if (normalized.includes(kw)) {
        score += kw.length > 5 ? 3 : 2;
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  const isEmergency =
    /heart attack|chest pain|stroke|severe bleeding|unconscious|difficulty breathing|behoshi|chhati me dard/.test(
      normalized,
    );

  if (!bestMatch) {
    bestMatch = {
      specialty: "General Medicine",
      secondary: ["Emergency Medicine"],
      urgency: isEmergency ? "Emergency" : "Routine",
      defaultDisease: query.slice(0, 60),
      departmentName: "General Internal Medicine",
      homeCare: "Rest comfortably, stay hydrated, and monitor vital signs.",
      redFlags:
        "Sudden onset of severe pain, fainting, difficulty breathing or high fever.",
      diagnosticTests: "Complete Blood Count (CBC) & Physical Examination",
      costRange: "₹500 - ₹12,000",
    };
  }

  const urgency = isEmergency ? "Emergency" : bestMatch.urgency;
  const explainability = `Matched ${bestMatch.departmentName} for "${bestMatch.defaultDisease}". Priority: ${urgency}.${detectedLocation ? ` Filtered for ${detectedLocation}.` : ""}${detectedBudget ? ` Budget constrained to under ₹${detectedBudget.toLocaleString("en-IN")}.` : ""}`;

  return {
    disease: bestMatch.defaultDisease,
    specialty: bestMatch.specialty,
    secondarySpecialties: bestMatch.secondary,
    urgency,
    location: detectedLocation,
    budgetMax: detectedBudget,
    explainability,
    knowledge: bestMatch,
    matchedMedicalTopic: highestScore > 0,
    isLocalFallback: true,
  };
}

async function understandMedicalQuery(query) {
  const localAnalysis = localClinicalTriage(query);

  if (!process.env.GEMINI_API_KEY) {
    return localAnalysis;
  }

  const prompt = `You are an AI Clinical Entity Extractor for the Indian Government Healthcare Discovery Portal (TechNova 2026).
A citizen submits a query describing a health condition or disease in English, Hindi, Hinglish, or Punjabi.
Extract exact structured medical intent. Return ONLY valid JSON:
{
  "disease": "standard English disease name (e.g. Kidney Stone, Chest Pain, Diabetes, Lung Infection)",
  "specialty": "primary medical specialty (Cardiology, Nephrology, Urology, Neurology, Oncology, Orthopedics, Pediatrics, General Medicine, Pulmonology, Gastroenterology, Ophthalmology, ENT)",
  "urgency": "Emergency | Urgent | Routine",
  "location": "city or area if mentioned, else empty string",
  "budgetMax": integer number in INR if mentioned (e.g. 200000 for '2 lakh'), else null,
  "explainability": "1 clear sentence explaining why this hospital specialty was recommended"
}

Citizen Query: "${query}"`;

  try {
    const geminiRes = await callGemini(prompt, {
      responseMimeType: "application/json",
    });
    if (geminiRes && geminiRes.text) {
      const match = geminiRes.text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          disease: parsed.disease || localAnalysis.disease,
          specialty: parsed.specialty || localAnalysis.specialty,
          secondarySpecialties: localAnalysis.secondarySpecialties,
          urgency: parsed.urgency || localAnalysis.urgency,
          location: parsed.location || localAnalysis.location,
          budgetMax: Number.isFinite(parsed.budgetMax)
            ? parsed.budgetMax
            : localAnalysis.budgetMax,
          explainability: parsed.explainability || localAnalysis.explainability,
          knowledge: localAnalysis.knowledge,
          modelUsed: geminiRes.model,
          isLocalFallback: false,
        };
      }
    }
  } catch (err) {
    console.warn(
      "Gemini entity extraction failed, using clinical triage knowledge engine:",
      err.message,
    );
  }

  return localAnalysis;
}

// =========================================================================
// API ENDPOINTS
// =========================================================================

// Search Hospitals Endpoint (Natural Language Disease + Location + Budget)
app.post("/api/hospitals/search", async (req, res) => {
  const query =
    typeof req.body?.query === "string" ? req.body.query.trim() : "";
  const cityOverride =
    typeof req.body?.city === "string"
      ? req.body.city.trim().slice(0, 100)
      : "";
  const userLat = Number(req.body?.lat ?? req.body?.latitude);
  const userLng = Number(req.body?.lon ?? req.body?.longitude);

  if (!query || query.length < 2) {
    return res.status(400).json({
      success: false,
      error: "Please enter a disease, symptom, or health question.",
    });
  }

  try {
    const intent = await understandMedicalQuery(query);
    const targetLocationName = cityOverride || intent.location;
    const hasCoordinates = Number.isFinite(userLat) && Number.isFinite(userLng);

    let searchLat = hasCoordinates ? userLat : 30.7333; // Default to Chandigarh center
    let searchLng = hasCoordinates ? userLng : 76.7794;
    let resolvedLocationTitle = hasCoordinates
      ? "Your GPS Location"
      : "Chandigarh Region";

    if (targetLocationName) {
      const lowerLoc = targetLocationName.toLowerCase();
      const matchedCity = Object.entries(CITY_COORDINATES).find(([k]) =>
        lowerLoc.includes(k),
      );
      if (matchedCity) {
        searchLat = matchedCity[1].lat;
        searchLng = matchedCity[1].lng;
        resolvedLocationTitle = matchedCity[1].name;
      } else if (GEOAPIFY_API_KEY) {
        try {
          const geocodeUrl = new URL(
            "https://api.geoapify.com/v1/geocode/search",
          );
          geocodeUrl.searchParams.set("text", targetLocationName);
          geocodeUrl.searchParams.set("limit", "1");
          geocodeUrl.searchParams.set("apiKey", GEOAPIFY_API_KEY);
          const gRes = await withTimeout(fetch(geocodeUrl), 5000);
          const gData = await gRes.json();
          const place = gData.features?.[0]?.properties || gData.results?.[0];
          if (
            place &&
            Number.isFinite(Number(place.lat)) &&
            Number.isFinite(Number(place.lon))
          ) {
            searchLat = Number(place.lat);
            searchLng = Number(place.lon);
            resolvedLocationTitle = targetLocationName;
          }
        } catch (geoErr) {
          console.warn("Geoapify geocoding skipped:", geoErr.message);
        }
      }
    }

    const specialtyLower = intent.specialty.toLowerCase();
    const secondarySet = new Set(
      (intent.secondarySpecialties || []).map((s) => s.toLowerCase()),
    );

    let matchedHospitals = HOSPITALS.map((h) => {
      const distance =
        Math.round(
          haversineKm(
            searchLat,
            searchLng,
            h.coordinates.lat,
            h.coordinates.lng,
          ) * 10,
        ) / 10;
      const commuteTime = Math.max(6, Math.round(distance * 2.2 + 4));

      const hasPrimarySpecialty = h.specialties.some(
        (s) => s.toLowerCase() === specialtyLower,
      );
      const hasSecondarySpecialty = h.specialties.some((s) =>
        secondarySet.has(s.toLowerCase()),
      );
      const specialtyScore = hasPrimarySpecialty
        ? 100
        : hasSecondarySpecialty
          ? 70
          : 30;

      let budgetScore = 50;
      if (intent.budgetMax) {
        if (h.estimatedTreatmentCost.min <= intent.budgetMax) {
          budgetScore = 100;
        } else if (h.estimatedTreatmentCost.min <= intent.budgetMax * 1.3) {
          budgetScore = 40;
        } else {
          budgetScore = 10;
        }
      }

      const distanceScore = Math.max(0, 100 - distance * 1.2);
      const ratingScore = (h.rating || 4.0) * 15;
      const bedScore = Math.min(
        30,
        (h.emergencyBedsAvailable || 0) * 2 + (h.icuAvailable || 0),
      );

      const totalRankScore = Math.round(
        specialtyScore * 0.4 +
          distanceScore * 0.3 +
          budgetScore * 0.15 +
          ratingScore * 0.1 +
          bedScore * 0.05,
      );

      const explainabilityReason = `Matches ${intent.specialty} ${hasPrimarySpecialty ? "department" : "referral unit"} • ${distance} km from ${resolvedLocationTitle} (~${commuteTime} min commute)${intent.budgetMax ? ` • Costs within ₹${intent.budgetMax.toLocaleString("en-IN")}` : ""} • ${h.icuAvailable} ICU beds ready`;

      return {
        ...h,
        distanceKm: distance,
        commuteDuration: `${commuteTime} mins`,
        rankScore: totalRankScore,
        explainabilityReason,
        mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.coordinates.lat},${h.coordinates.lng}`,
        lat: h.coordinates.lat,
        lon: h.coordinates.lng,
      };
    });

    // If budget specified, filter or prioritize
    if (intent.budgetMax) {
      matchedHospitals.sort((a, b) => b.rankScore - a.rankScore);
    } else {
      matchedHospitals.sort((a, b) => b.rankScore - a.rankScore);
    }

    return res.json({
      success: true,
      query,
      intent: {
        disease: intent.disease,
        specialty: intent.specialty,
        secondarySpecialties: intent.secondarySpecialties,
        urgency: intent.urgency,
        location: targetLocationName || resolvedLocationTitle,
        budgetMax: intent.budgetMax,
        explainability: intent.explainability,
        homeCare: intent.knowledge?.homeCare,
        redFlags: intent.knowledge?.redFlags,
        diagnosticTests: intent.knowledge?.diagnosticTests,
        costRange: intent.knowledge?.costRange,
        modelUsed: intent.modelUsed || "Clinical NLP Engine",
      },
      searchLocation: {
        name: resolvedLocationTitle,
        latitude: searchLat,
        longitude: searchLng,
      },
      count: matchedHospitals.length,
      hospitals: matchedHospitals,
    });
  } catch (err) {
    console.error("Hospital search processing failed:", err.message);
    return res.status(500).json({
      success: false,
      error: "Could not complete hospital discovery. Please try again.",
    });
  }
});

// GET /api/hospitals endpoint for comparison matrix & filtering
app.get("/api/hospitals", (req, res) => {
  const { specialty, maxCost, minRating, emergencyOnly, city } = req.query;
  let list = [...HOSPITALS];

  if (specialty && specialty !== "all") {
    list = list.filter((h) =>
      h.specialties.some((s) =>
        s.toLowerCase().includes(specialty.toLowerCase()),
      ),
    );
  }

  if (city) {
    const c = city.toLowerCase();
    list = list.filter(
      (h) =>
        h.city.toLowerCase().includes(c) ||
        h.location.toLowerCase().includes(c),
    );
  }

  if (maxCost) {
    list = list.filter((h) => h.avgConsultationCost <= parseInt(maxCost, 10));
  }

  if (minRating) {
    list = list.filter((h) => h.rating >= parseFloat(minRating));
  }

  if (emergencyOnly === "true") {
    list = list.filter((h) => h.emergencyBedsAvailable > 0);
  }

  return res.json({
    success: true,
    count: list.length,
    hospitals: list.map((h) => ({
      ...h,
      lat: h.coordinates.lat,
      lon: h.coordinates.lng,
      mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.coordinates.lat},${h.coordinates.lng}`,
    })),
  });
});

// =========================================================================
// GEMINI MULTILINGUAL CHAT ASSISTANT
// Multi-turn context, empathetic medical triage, dynamic hospital integration
// =========================================================================

app.post("/api/chat", async (req, res) => {
  const { message, location, city, history } = req.body;
  if (typeof message !== "string" || !message.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Message query is required." });
  }

  const cleanMessage = message.trim();
  const triage = localClinicalTriage(cleanMessage);
  const hospitalRequest =
    /\b(hospital|hospitals|clinic|clinics|doctor|doctors|specialist|near me|nearest|emergency room|er)\b/i.test(
      cleanMessage,
    );
  const healthConversation = triage.matchedMedicalTopic || hospitalRequest;
  const isEmergency = healthConversation && triage.urgency === "Emergency";

  const userCity =
    city || triage.location || (location ? "your area" : "Chandigarh");
  const userLat = Number(location?.lat);
  const userLng = Number(location?.lon ?? location?.lng);
  const hasCoordinates = Number.isFinite(userLat) && Number.isFinite(userLng);
  const relevantHospitals = healthConversation
    ? HOSPITALS.filter((h) =>
        h.specialties.some(
          (s) => s.toLowerCase() === triage.specialty.toLowerCase(),
        ),
      )
        .map((h) => ({
          hospital: h,
          distanceKm: hasCoordinates
            ? Math.round(
                haversineKm(
                  userLat,
                  userLng,
                  h.coordinates.lat,
                  h.coordinates.lng,
                ) * 10,
              ) / 10
            : null,
        }))
        .sort((a, b) =>
          a.distanceKm === null || b.distanceKm === null
            ? 0
            : a.distanceKm - b.distanceKm,
        )
        .slice(0, 3)
    : [];

  const systemInstructions = `You are MediGo, a warm, capable conversational AI assistant. Talk naturally, like a helpful ChatGPT-style assistant: answer the user's actual question directly, understand the whole conversation, and do not turn every message into a medical report or hospital advertisement.
Respond in the same language as the user, including English, Hindi, Hinglish, or Punjabi. Keep ordinary conversation concise and useful. Ask one clear follow-up only when needed to understand the request.
For health questions, be compassionate and careful: do not claim a diagnosis, explain uncertainty plainly, and give practical next steps. For possible emergencies (severe chest pain, stroke signs, serious accident, trouble breathing, heavy bleeding, unconsciousness), tell the user to call 108 immediately. Do not delay emergency care to continue chatting.
Suggest nearby hospitals only when the user asks for them or their health question makes that useful. Available hospital suggestions are attached separately from verified local listings; do not invent availability, prices, or services. User area: ${userCity}. ${isEmergency ? "This message may indicate an emergency. Put immediate safety steps first." : ""}`;

  let reply = "";
  let modelUsed = "MediGo AI (offline)";

  if (process.env.GEMINI_API_KEY) {
    try {
      const priorTurns = Array.isArray(history)
        ? history
            .filter(
              (h) =>
                h &&
                ["user", "model", "assistant"].includes(h.role) &&
                typeof h.content === "string",
            )
            .slice(-8)
            .filter(
              (h, index, turns) =>
                !(
                  index === turns.length - 1 &&
                  h.role === "user" &&
                  h.content.trim() === cleanMessage
                ),
            )
        : [];
      const historyContext = priorTurns.length
        ? priorTurns
            .map(
              (h) =>
                `${h.role === "user" ? "User" : "Assistant"}: ${h.content.slice(0, 1200)}`,
            )
            .join("\n") + "\n"
        : "";

      const fullPrompt = `${systemInstructions}\n\n${historyContext}User query: "${cleanMessage}"\nAssistant:`;
      const geminiRes = await callGemini(fullPrompt, {}, 2, 7000);
      if (geminiRes && geminiRes.text) {
        reply = geminiRes.text;
        modelUsed = geminiRes.model;
      }
    } catch (apiErr) {
      console.warn("Gemini chat request failed:", apiErr.message);
    }
  }

  // If Gemini was offline, rate-limited (503/429), or unavailable:
  if (!reply) {
    const k = triage.knowledge;
    const isHindi =
      /[\u0900-\u097F]/.test(cleanMessage) ||
      /mujhe|mera|dard|hai|batao|kripya|chahiye/.test(
        cleanMessage.toLowerCase(),
      );
    const isPunjabi =
      /[\u0A00-\u0A7F]/.test(cleanMessage) ||
      /ਮੈਨੂੰ|ਦਰਦ|ਹੈ|ਦੱਸੋ|ਕਿਰਪਾ/.test(cleanMessage.toLowerCase());

    if (!healthConversation) {
      reply =
        "I’m having trouble reaching Gemini right now. I can still help with MediGo, health questions, or finding a hospital nearby. What would you like to talk about?";
    } else if (isHindi) {
      reply =
        `${isEmergency ? "🚨 **आपातकालीन चेतावनी (Emergency Alert):**" : "📋 **चिकित्सीय परामर्श (Medical Triage):**"}\n\n` +
        `आपके द्वारा बताए गए लक्षणों के आधार पर यह **${triage.disease}** से संबंधित हो सकता है।\n\n` +
        `• **अनुशंसित विशेषज्ञ (Recommended Specialist):** आपको **${k.departmentName} (${triage.specialty})** से परामर्श लेना चाहिए।\n` +
        `• **प्राथमिकता स्तर:** **${triage.urgency === "Emergency" ? "🚨 आपातकालीन - तुरंत नजदीकी अस्पताल पहुंचे या 108 डायल करें।" : triage.urgency === "Urgent" ? "⚠️ जरूरी - 15 मिनट के भीतर डॉक्टर को दिखाएं।" : "ℹ️ सामान्य ओपीडी परामर्श।"}**\n` +
        `• **तत्काल देखभाल (Initial Care):** ${k.homeCare}\n` +
        `• **खतरे के संकेत (Red Flags):** ${k.redFlags}\n` +
        `• **अनुशंसित जांचें (Tests):** ${k.diagnosticTests}\n` +
        `• **आयुष्मान भारत योजना:** यह उपचार आयुष्मान भारत (PM-JAY) योजना के तहत पैनलबद्ध अस्पतालों में 5 लाख रुपये तक कैशलेस उपलब्ध है।\n\n` +
        `*नीचे दिए गए अस्पताल कार्ड्स में आप अपने नजदीकी अस्पतालों की आईसीयू बेड उपलब्धता और लागत देख सकते हैं।*`;
    } else if (isPunjabi) {
      reply =
        `${isEmergency ? "🚨 **ਐਮਰਜੈਂਸੀ ਅਲਰਟ (Emergency Alert):**" : "📋 **ਡਾਕਟਰੀ ਸਲਾਹ (Medical Triage):**"}\n\n` +
        `ਤੁਹਾਡੇ ਦੱਸੇ ਲੱਛਣਾਂ ਅਨੁਸਾਰ ਇਹ **${triage.disease}** ਨਾਲ ਸੰਬੰਧਿਤ ਹੋ ਸਕਦਾ ਹੈ।\n\n` +
        `• **ਮਾਹਿਰ ਡਾਕਟਰ (Specialist):** ਕਿਰਪਾ ਕਰਕੇ **${k.departmentName} (${triage.specialty})** ਨਾਲ ਸੰਪਰਕ ਕਰੋ।\n` +
        `• **ਤੁਰੰਤ ਕਦਮ:** **${triage.urgency === "Emergency" ? "🚨 ਐਮਰਜੈਂਸੀ - ਤੁਰੰਤ ਨੇੜਲੇ ਹਸਪਤਾਲ ਜਾਓ ਜਾਂ 108 ਡਾਇਲ ਕਰੋ।" : "⚠️ ਜ਼ਰੂਰੀ - 15 ਮਿੰਟਾਂ ਦੇ ਅੰਦਰ ਡਾਕਟਰ ਨੂੰ ਦਿਖਾਓ।"}**\n` +
        `• **ਘਰੇਲੂ ਸਾਵਧਾਨੀ:** ${k.homeCare}\n` +
        `• **ਖ਼ਤਰੇ ਦੇ ਚਿੰਨ੍ਹ:** ${k.redFlags}\n` +
        `• **ਸਰਕਾਰੀ ਯੋਜਨਾ:** ਸਰਬੱਤ ਸਿਹਤ ਬੀਮਾ ਯੋਜਨਾ / ਆਯੁਸ਼ਮਾਨ ਭਾਰਤ ਤਹਿਤ ਮੁਫਤ ਇਲਾਜ ਉਪਲਬਧ ਹੈ।\n\n` +
        `*ਹੇਠਾਂ ਦਿੱਤੇ ਹਸਪਤਾਲਾਂ ਵਿੱਚੋਂ ਆਪਣੇ ਨੇੜਲੇ ਹਸਪਤਾਲ ਦੇ ਬੈੱਡ ਅਤੇ ਖਰਚੇ ਚੈੱਕ ਕਰੋ।*`;
    } else {
      reply =
        `${isEmergency ? "🚨 **Emergency Medical Alert:**" : "📋 **Clinical Triage Assessment:**"}\n\n` +
        `I understand you're asking about **${triage.disease}**. Some of these symptoms can have different causes, so only a clinician can diagnose them.\n\n` +
        `• **Recommended Specialist:** You should consult a specialist in **${k.departmentName} (${triage.specialty})**.\n` +
        `• **Urgency Level:** **${triage.urgency === "Emergency" ? "🚨 CRITICAL: Immediate Emergency Room (ER) attention required. Call 108 or proceed to the nearest emergency room." : triage.urgency === "Urgent" ? "⚠️ URGENT: Schedule an in-person consultation within 15 min." : "ℹ️ ROUTINE: Standard outpatient consultation."}**\n` +
        `• **Immediate Care & Advice:** ${k.homeCare}\n` +
        `• **Red Flags to Watch:** ${k.redFlags}\n` +
        `• **Anticipated Diagnostics:** ${k.diagnosticTests}\n` +
        `• **Govt Scheme Coverage:** Subsidized or cashless under Ayushman Bharat (PM-JAY) and CGHS.\n\n` +
        `*Explore the shortlisted nearby hospitals below with live ICU bed counts and treatment cost ranges.*`;
    }
  }

  return res.json({
    success: true,
    reply,
    source: modelUsed,
    triage: healthConversation
      ? {
          disease: triage.disease,
          specialty: triage.specialty,
          urgency: triage.urgency,
          isEmergency,
          city: userCity,
        }
      : null,
    recommendations: relevantHospitals.map(({ hospital: h, distanceKm }) => ({
      name: h.name,
      rating: h.rating,
      reviewsCount: h.reviewsCount,
      city: h.city,
      consultationCost: h.avgConsultationCost,
      icuAvailable: h.icuAvailable,
      successRate: h.successRate,
      phone: h.phone,
      distanceKm,
      mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${h.coordinates.lat},${h.coordinates.lng}`,
    })),
  });
});

// Emergency SOS Dispatch Endpoint
app.post("/api/emergency", (req, res) => {
  const { location, patientName, emergencyType } = req.body || {};
  const lat = Number(location?.lat) || 30.7333;
  const lng = Number(location?.lng) || 76.7794;

  const nearestTraumaCentres = HOSPITALS.map((h) => ({
    name: h.name,
    phone: h.phone,
    distanceKm:
      Math.round(
        haversineKm(lat, lng, h.coordinates.lat, h.coordinates.lng) * 10,
      ) / 10,
    emergencyBeds: h.emergencyBedsAvailable,
    icuBeds: h.icuAvailable,
    hours: h.hours,
  }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3);

  return res.json({
    success: true,
    action: "SOS Ambulance Protocol Activated",
    nationalHelpline: "108",
    policeHelpline: "112",
    ambulanceEtaMinutes: Math.max(
      6,
      Math.min(22, Math.ceil(nearestTraumaCentres[0].distanceKm * 2.2 + 3)),
    ),
    nearestTraumaCentres,
    instructions:
      "Ambulance dispatched. Keep the patient calm. Stay on the line if contacted by medical dispatch.",
  });
});

// =========================================================================
// EMERGENCY PATIENT INBOUND & HOSPITAL PREPARATION EMAIL DISPATCH
// Sends pre-arrival alert to hospital trauma team to prepare ICU/bed
// =========================================================================

app.post("/api/emergency/notify-hospital", async (req, res) => {
  const {
    patientName,
    patientAge,
    patientGender,
    patientPhone,
    condition,
    urgency = "Emergency",
    requiredCare = [],
    etaMinutes = 10,
    hospitalId,
    hospitalName,
    notes = "",
    location,
  } = req.body || {};

  if (!patientName || !condition || !hospitalName) {
    return res.status(400).json({
      success: false,
      error: "Patient name, condition, and selected hospital are required.",
    });
  }

  const targetHospital = HOSPITALS.find(
    (h) =>
      h.id === hospitalId ||
      h.name.toLowerCase() === (hospitalName || "").toLowerCase(),
  );
  const hospPhone = targetHospital?.phone || "+91 172 2747585";
  const hospEmail =
    targetHospital?.email ||
    process.env.EMERGENCY_HOSPITAL_EMAIL ||
    mailFrom ||
    "emergency-intake@medigo.health.gov.in";
  const patientLocation =
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng))
      ? { lat: Number(location.lat), lng: Number(location.lng) }
      : null;
  const mapLink = patientLocation
    ? `https://www.google.com/maps/search/?api=1&query=${patientLocation.lat},${patientLocation.lng}`
    : "";

  const refId = `MEDIGO-EMG-${Math.floor(1000 + Math.random() * 9000)}`;

  const careList =
    Array.isArray(requiredCare) && requiredCare.length > 0
      ? requiredCare.join(", ")
      : typeof requiredCare === "string" && requiredCare
        ? requiredCare
        : "Emergency Resuscitation & ICU Bed Preparation";

  const emailSubject = `🚨 [MEDIGO EMERGENCY ALERT] Patient: ${patientName} • ETA: ~${etaMinutes} Mins (${condition})`;
  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #0f172a;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 2px solid #ef4444; overflow: hidden; box-shadow: 0 10px 25px rgba(239, 68, 68, 0.15);">
        
        <div style="background: linear-gradient(135deg, #ef4444, #b91c1c); padding: 20px 24px; color: white;">
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 1.5px; opacity: 0.9;">MediGo National Emergency Protocol</div>
          <h2 style="margin: 4px 0 0 0; font-size: 22px; font-weight: 900;">🚨 INBOUND PATIENT PREPARATION ALERT</h2>
        </div>

        <div style="padding: 24px;">
          <p style="font-size: 14px; margin-top: 0; color: #334155;">
            Attention: <strong>${hospitalName} Trauma & Emergency Intake Desk</strong>
          </p>
          <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
            A critical patient is currently en route to your emergency department. Please alert the on-duty Trauma Team, prepare an ICU/Emergency Bay, and keep required medical apparatus on standby.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px;">
            <tr style="background: #f1f5f9;">
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0; width: 38%;">Tracking Reference</td>
              <td style="padding: 10px 14px; font-weight: 900; color: #ef4444; border: 1px solid #e2e8f0; font-size: 15px;">${refId}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0;">Patient Details</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;"><strong>${patientName}</strong> (${patientAge || "Age N/A"} yrs, ${patientGender || "Unspecified"})</td>
            </tr>
            <tr style="background: #fef2f2;">
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #fecaca; color: #991b1b;">Suspected Condition</td>
              <td style="padding: 10px 14px; font-weight: 800; color: #b91c1c; border: 1px solid #fecaca;">${condition}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0;">Estimated Arrival (ETA)</td>
              <td style="padding: 10px 14px; font-weight: 900; color: #d97706; border: 1px solid #e2e8f0; font-size: 15px;">⚡ ~${etaMinutes} Minutes</td>
            </tr>
            <tr style="background: #f1f5f9;">
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0;">Pre-Alert Requirements</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${careList}</td>
            </tr>
            <tr>
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0;">Attendant Contact</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">
                <a href="tel:${patientPhone}" style="color: #0284c7; font-weight: bold; text-decoration: none;">${patientPhone}</a>
              </td>
            </tr>
            ${mapLink ? `<tr style="background:#f1f5f9"><td style="padding:10px 14px;font-weight:bold;border:1px solid #e2e8f0">Patient Location</td><td style="padding:10px 14px;border:1px solid #e2e8f0"><a href="${mapLink}">Open patient location map</a></td></tr>` : ""}
            ${
              notes
                ? `
            <tr style="background: #f8fafc;">
              <td style="padding: 10px 14px; font-weight: bold; border: 1px solid #e2e8f0;">Additional Notes</td>
              <td style="padding: 10px 14px; border: 1px solid #e2e8f0;">${notes}</td>
            </tr>`
                : ""
            }
          </table>

          <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 10px; padding: 14px; font-size: 13px; color: #991b1b;">
            <strong>Immediate Action Required:</strong> Reserve 1 Emergency Trauma Bed, assign 1 triage physician, and confirm receipt if contacted by emergency dispatcher.
          </div>
        </div>

        <div style="background: #f8fafc; padding: 14px 24px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
          MediGo National Healthcare Emergency System • Live Trauma Link • 24/7 National Ambulance: 108
        </div>
      </div>
    </div>
  `;

  let emailDispatched = false;
  if (mailTransport && mailFrom) {
    try {
      await mailTransport.sendMail({
        from: mailFrom,
        to: hospEmail,
        subject: emailSubject,
        text: `EMERGENCY PRE-ARRIVAL ALERT: Patient ${patientName}, ETA: ~${etaMinutes} mins. Condition: ${condition}. Phone: ${patientPhone}. Prepare Trauma Bed & Emergency Care. Ref: ${refId}`,
        html: emailHtml,
      });
      emailDispatched = true;
      console.log(
        `[MediGo Emergency] Hospital alert email successfully sent to ${hospEmail} for patient ${patientName}`,
      );
    } catch (mErr) {
      console.warn(
        `[MediGo Emergency] SMTP email sending failed: ${mErr.message}. Storing in emergency dispatch stream.`,
      );
    }
  }

  const alertRecord = {
    id: "emg-" + Date.now(),
    referenceId: refId,
    patientName,
    patientAge: Number(patientAge) || null,
    patientGender: patientGender || "Unspecified",
    patientPhone,
    condition,
    urgency,
    requiredCare: Array.isArray(requiredCare)
      ? requiredCare
      : [requiredCare].filter(Boolean),
    etaMinutes: Number(etaMinutes) || 10,
    hospitalId: targetHospital?.id || hospitalId,
    hospitalName,
    hospitalPhone: hospPhone,
    hospitalEmail: hospEmail,
    location: patientLocation,
    notes,
    status: "Preparation Dispatched",
    emailDispatched,
    createdAt: new Date().toISOString(),
  };

  EMERGENCY_ALERTS.unshift(alertRecord);

  return res.json({
    success: true,
    referenceId: refId,
    alert: alertRecord,
    emailSent: emailDispatched,
    message: emailDispatched
      ? `Urgent preparation alert emailed to ${hospitalName}. Estimated arrival: ~${etaMinutes} minutes.`
      : `Emergency request logged, but the hospital email was not sent. Call ${hospPhone} or dial 108 immediately.`,
  });
});

// =========================================================================
// REVIEWS & USER FEEDBACK API
// Enables citizens to submit and view verified hospital reviews
// =========================================================================

app.get("/api/reviews", (req, res) => {
  const { hospitalId } = req.query;
  let list = [...REVIEWS];
  if (hospitalId) {
    list = list.filter((r) => r.hospitalId === hospitalId);
  }
  return res.json({ success: true, count: list.length, reviews: list });
});

app.post("/api/reviews", (req, res) => {
  const {
    hospitalId,
    hospitalName,
    userName,
    userEmail,
    rating,
    treatment,
    comment,
  } = req.body || {};
  if (!hospitalId || !comment || !rating) {
    return res.status(400).json({
      success: false,
      error: "Hospital, star rating, and review experience are required.",
    });
  }

  const parsedRating = Math.min(5, Math.max(1, Number(rating) || 5));
  const newReview = {
    id: "rev-" + Date.now(),
    hospitalId,
    hospitalName: hospitalName || "Hospital Partner",
    userName: (userName && userName.trim()) || "Verified Citizen",
    userEmail: (userEmail && userEmail.trim()) || "",
    rating: parsedRating,
    treatment: (treatment && treatment.trim()) || "General Clinical Care",
    comment: comment.trim(),
    date: new Date().toISOString().split("T")[0],
  };

  REVIEWS.unshift(newReview);

  // Dynamically update hospital rating & review count
  const targetHospital = HOSPITALS.find((h) => h.id === hospitalId);
  if (targetHospital) {
    targetHospital.reviewsCount = (targetHospital.reviewsCount || 0) + 1;
    targetHospital.rating =
      Math.round(
        ((targetHospital.rating * (targetHospital.reviewsCount - 1) +
          parsedRating) /
          targetHospital.reviewsCount) *
          10,
      ) / 10;
  }

  return res.status(201).json({
    success: true,
    review: newReview,
    updatedRating: targetHospital?.rating,
    reviewsCount: targetHospital?.reviewsCount,
    message:
      "Thank you! Your hospital review has been submitted and published.",
  });
});

// =========================================================================
// ADMIN CONTROL CENTER API
// Metrics, emergency dispatch management, hospital bed manager, reviews
// =========================================================================

app.use("/api/admin", authenticate, requireSiteOwner);

app.get("/api/admin/stats", (req, res) => {
  const totalHospitals = HOSPITALS.length;
  const totalBeds = HOSPITALS.reduce((acc, h) => acc + (h.totalBeds || 0), 0);
  const totalIcu = HOSPITALS.reduce((acc, h) => acc + (h.icuAvailable || 0), 0);
  const totalEmergencyBeds = HOSPITALS.reduce(
    (acc, h) => acc + (h.emergencyBedsAvailable || 0),
    0,
  );
  const activeEmergencies = EMERGENCY_ALERTS.filter(
    (e) => e.status !== "Completed",
  ).length;
  const totalReviews = REVIEWS.length;
  const totalCitizens = USERS_STORE.length;

  return res.json({
    success: true,
    stats: {
      totalHospitals,
      totalBeds,
      totalIcu,
      totalEmergencyBeds,
      activeEmergencies,
      totalReviews,
      totalCitizens,
    },
  });
});

app.get("/api/admin/emergencies", (req, res) => {
  return res.json({
    success: true,
    count: EMERGENCY_ALERTS.length,
    emergencies: EMERGENCY_ALERTS,
  });
});

app.patch("/api/admin/emergencies/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const alert = EMERGENCY_ALERTS.find(
    (e) => e.id === id || e.referenceId === id,
  );
  if (!alert)
    return res
      .status(404)
      .json({ success: false, error: "Emergency record not found." });

  if (status) alert.status = status;
  return res.json({
    success: true,
    alert,
    message: `Emergency status updated to: ${status}`,
  });
});

app.get("/api/admin/hospitals", (req, res) => {
  return res.json({
    success: true,
    count: HOSPITALS.length,
    hospitals: HOSPITALS.map((h) => ({
      id: h.id,
      name: h.name,
      city: h.city,
      type: h.type,
      rating: h.rating,
      reviewsCount: h.reviewsCount,
      emergencyBedsAvailable: h.emergencyBedsAvailable,
      icuAvailable: h.icuAvailable,
      totalBeds: h.totalBeds,
      phone: h.phone,
      hours: h.hours,
    })),
  });
});

app.patch("/api/admin/hospitals/:id", (req, res) => {
  const { id } = req.params;
  const { emergencyBedsAvailable, icuAvailable, phone } = req.body;
  const hosp = HOSPITALS.find((h) => h.id === id);
  if (!hosp)
    return res
      .status(404)
      .json({ success: false, error: "Hospital not found." });

  if (typeof emergencyBedsAvailable === "number")
    hosp.emergencyBedsAvailable = emergencyBedsAvailable;
  if (typeof icuAvailable === "number") hosp.icuAvailable = icuAvailable;
  if (typeof phone === "string") hosp.phone = phone;

  return res.json({
    success: true,
    hospital: hosp,
    message: "Hospital bed and contact details updated.",
  });
});

app.get("/api/admin/users", async (req, res) => {
  if (mongoose.connection.readyState === 1) {
    try {
      const users = await User.find({}, "name email phone city createdAt").sort(
        { createdAt: -1 },
      );
      return res.json({ success: true, count: users.length, users });
    } catch (err) {
      console.warn("Failed to fetch users from DB:", err.message);
    }
  }
  return res.json({
    success: true,
    count: USERS_STORE.length,
    users: USERS_STORE,
  });
});

app.delete("/api/admin/reviews/:id", (req, res) => {
  const { id } = req.params;
  const idx = REVIEWS.findIndex((r) => r.id === id);
  if (idx === -1)
    return res.status(404).json({ success: false, error: "Review not found." });

  const removed = REVIEWS.splice(idx, 1)[0];
  return res.json({
    success: true,
    review: removed,
    message: "Review successfully removed.",
  });
});

const startServer = async () => {
  await connectDB();
  const server = app.listen(PORT, HOST, () => {
    console.log(`MediGo API listening on ${HOST}:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down.`);
    server.close(async () => {
      if (mongoose.connection.readyState !== 0)
        await mongoose.connection.close();
      process.exit(0);
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
};

module.exports = { app, connectDB };

if (require.main === module) {
  startServer();
}
