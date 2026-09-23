const express = require("express");
const mongoose = require("mongoose");
const Hospital = require("../models/Hospital");

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEPARTMENTS = [
  "Cardiology",
  "Nephrology",
  "Urology",
  "Neurology",
  "Oncology",
  "Orthopedics",
  "Pediatrics",
  "Pulmonology",
  "Gastroenterology",
  "Ophthalmology",
  "ENT",
  "General Medicine",
];
const SEVERITY_LEVELS = ["routine", "urgent", "emergency", "unclear"];

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function normalizeAnalysis(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const department = DEPARTMENTS.find(
    (item) => item.toLowerCase() === String(raw.department || raw.recommendedDepartment || "").trim().toLowerCase(),
  );
  const severity = SEVERITY_LEVELS.includes(String(raw.severity || "").toLowerCase())
    ? String(raw.severity).toLowerCase()
    : "unclear";

  return {
    documentType: String(raw.documentType || "medical document").slice(0, 80),
    diagnosisKeywords: Array.isArray(raw.diagnosisKeywords)
      ? raw.diagnosisKeywords
          .filter((item) => typeof item === "string")
          .slice(0, 12)
          .map((item) => item.trim().slice(0, 120))
      : [],
    possibleCondition: String(raw.possibleCondition || "Not clearly identified").slice(0, 160),
    department: department || "General Medicine",
    recommendedDepartment: department || "General Medicine",
    analysisAvailable: raw.analysisAvailable !== false,
    severity,
    summary: String(raw.summary || "The document could not be summarized confidently.").slice(0, 500),
  };
}

function fallbackAnalysis(language = "en") {
  const summaries = {
    en: "The report could not be read right now. No findings or diagnosis were inferred. Please try again later or ask a qualified healthcare professional.",
    hi: "रिपोर्ट अभी पढ़ी नहीं जा सकी। कोई निष्कर्ष या बीमारी का अनुमान नहीं लगाया गया है। बाद में फिर कोशिश करें या योग्य डॉक्टर से बात करें।",
    "hi-Latn": "Report abhi read nahi ho paayi. Koi finding ya diagnosis assume nahi kiya gaya. Baad mein try karein ya qualified doctor se baat karein.",
    pa: "ਰਿਪੋਰਟ ਹੁਣੇ ਪੜ੍ਹੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਕੋਈ ਨਤੀਜਾ ਜਾਂ ਬਿਮਾਰੀ ਦਾ ਅਨੁਮਾਨ ਨਹੀਂ ਲਗਾਇਆ ਗਿਆ। ਬਾਅਦ ਵਿੱਚ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ ਜਾਂ ਯੋਗ ਡਾਕਟਰ ਨਾਲ ਗੱਲ ਕਰੋ।",
  };
  return {
    documentType: "medical document",
    diagnosisKeywords: [],
    possibleCondition: "Not clearly identified",
    department: "General Medicine",
    recommendedDepartment: "General Medicine",
    severity: "unclear",
    summary: summaries[language] || summaries.en,
    analysisAvailable: false,
  };
}

function distanceKm(origin, coordinates) {
  if (!origin || !coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) {
    return null;
  }
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(coordinates.lat - origin.lat);
  const dLng = radians(coordinates.lng - origin.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(origin.lat)) *
      Math.cos(radians(coordinates.lat)) *
      Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function matchesDepartment(hospital, department) {
  return (hospital.specialties || []).some((specialty) =>
    String(specialty).toLowerCase().includes(department.toLowerCase()),
  );
}

function safeHospital(hospital, origin) {
  const coordinates = hospital.coordinates || {
    lat: hospital.lat,
    lng: hospital.lon ?? hospital.lng,
  };
  const lat = Number(coordinates?.lat);
  const lng = Number(coordinates?.lng);
  const distance = distanceKm(origin, coordinates);
  return {
    id: String(hospital.id || hospital._id || ""),
    name: String(hospital.name || "Hospital"),
    city: String(hospital.city || ""),
    location: String(hospital.location || hospital.city || ""),
    specialties: Array.isArray(hospital.specialties) ? hospital.specialties : [],
    phone: String(hospital.phone || ""),
    rating: Number.isFinite(Number(hospital.rating)) ? Number(hospital.rating) : null,
    icuAvailable: Number.isFinite(Number(hospital.icuAvailable)) ? Number(hospital.icuAvailable) : null,
    emergencyBedsAvailable: Number.isFinite(Number(hospital.emergencyBedsAvailable))
      ? Number(hospital.emergencyBedsAvailable)
      : 0,
    estimatedTreatmentCost: hospital.estimatedTreatmentCost || null,
    avgConsultationCost: Number.isFinite(Number(hospital.avgConsultationCost))
      ? Number(hospital.avgConsultationCost)
      : null,
    insuranceAccepted: Array.isArray(hospital.insuranceAccepted) ? hospital.insuranceAccepted : [],
    image: typeof hospital.image === "string" ? hospital.image : "",
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lng) ? lng : null,
    distanceKm: distance,
    mapUrl:
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        : "",
  };
}

function createReportReaderRouter({ fallbackHospitals, analyzeImage }) {
  const router = express.Router();

  router.post(
    "/analyze",
    express.raw({ type: "image/*", limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: "Upload a JPEG, PNG, or WebP image." });
      }
      if (req.body.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ success: false, error: "Image must be 8 MB or smaller." });
      }

      const declaredMime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      const detectedMime = detectImageMime(req.body);
      if (!ALLOWED_MIME_TYPES.has(declaredMime) || !detectedMime || declaredMime !== detectedMime) {
        return res.status(415).json({
          success: false,
          error: "Unsupported or invalid image. Use a genuine JPEG, PNG, or WebP file.",
        });
      }

      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const origin = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng }
        : null;
      const city = typeof req.query.city === "string" ? req.query.city.trim().slice(0, 100) : "";
      const supportedLanguages = new Set(["en", "hi", "hi-Latn", "pa"]);
      const language = supportedLanguages.has(String(req.query.language || ""))
        ? String(req.query.language)
        : "en";

      try {
        let rawAnalysis;
        try {
          rawAnalysis = await analyzeImage(req.body, detectedMime, language);
        } catch (analysisError) {
          console.error("Report AI analysis failed; returning safe fallback:", analysisError.message);
          rawAnalysis = fallbackAnalysis(language);
        }
        const analysis = normalizeAnalysis(rawAnalysis);
        const specialtyRegex = new RegExp(analysis.department.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        let hospitalRecords = [];
        let hospitalSource = "local-directory";

        if (mongoose.connection.readyState === 1) {
          const mongoQuery = { specialties: specialtyRegex };
          if (city) {
            mongoQuery.$or = [
              { city: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
              { location: new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
            ];
          }
          try {
            hospitalRecords = await Hospital.find(mongoQuery).limit(50).lean();
            if (hospitalRecords.length) hospitalSource = "mongodb";
          } catch (databaseError) {
            console.warn("Report reader MongoDB lookup failed; using bundled directory:", databaseError.message);
          }
        }

        if (!hospitalRecords.length) {
          hospitalRecords = fallbackHospitals.filter((hospital) => {
            const specialtyMatch = matchesDepartment(hospital, analysis.department);
            const cityMatch = !city || `${hospital.city || ""} ${hospital.location || ""}`.toLowerCase().includes(city.toLowerCase());
            return specialtyMatch && cityMatch;
          });
        }

        const hospitals = hospitalRecords
          .map((hospital) => safeHospital(hospital, origin))
          .sort((a, b) => {
            if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
            return (b.rating || 0) - (a.rating || 0);
          })
          .slice(0, 12);

        return res.json({
          success: true,
          analysis,
          analysisAvailable: analysis.analysisAvailable,
          message: analysis.analysisAvailable ? "Analysis complete." : analysis.summary,
          hospitals,
          hospitalSource,
          disclaimer: "AI may misread medical documents. Confirm all findings with a qualified healthcare professional.",
        });
      } catch (error) {
        console.error("Medical report analysis failed:", error.message);
        const providerMessage = String(error.message || error.cause?.message || "").toLowerCase();
        const publicMessage = /timeout|timed out|deadline/.test(providerMessage)
          ? "Report analysis timed out. Try a smaller, clearer image."
          : /429|quota|rate.?limit/.test(providerMessage)
            ? "Report analysis is temporarily busy. Please wait a minute and try again."
            : /api.?key|permission|unauthorized|403|401/.test(providerMessage)
              ? "The report analysis service is not authorized. Check the Gemini API key and model access in the backend environment."
              : /fetch failed|network|econn|enotfound|eai_again|socket/.test(providerMessage)
                ? "The backend could not connect to Google Gemini. Check server internet, DNS, or proxy settings, then retry."
                : /404|not found|unknown model|invalid model/.test(providerMessage)
                  ? "The configured Gemini model is unavailable. Use a supported model name such as gemini-3.8-flash."
              : "Report analysis service failed. Check the Gemini API key, model access, and backend logs, then try again.";
        return res.status(502).json({
          success: false,
          error: publicMessage,
        });
      }
    },
  );

  router.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({ success: false, error: "Image must be 8 MB or smaller." });
    }
    if (error.type === "encoding.unsupported" || error.type === "entity.parse.failed") {
      return res.status(400).json({ success: false, error: "Could not read the uploaded image." });
    }
    return next(error);
  });

  return router;
}

module.exports = { createReportReaderRouter, DEPARTMENTS, SEVERITY_LEVELS, fallbackAnalysis };
