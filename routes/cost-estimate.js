const express = require("express");
const mongoose = require("mongoose");
const ProcedureCost = require("../models/ProcedureCost");
const { DEMO_PROCEDURE_COSTS } = require("../data/procedure-costs");

const PROCEDURES = new Map(DEMO_PROCEDURE_COSTS.map((item) => [item.procedureKey, item]));
const SCHEMES = new Set(["PM-JAY", "CGHS"]);
const PROCEDURE_ALIASES = {
  "knee-replacement": ["knee", "knee replacement", "knee operation", "ghutna", "ghutne ka operation", "joint replacement"],
  "bypass-surgery": ["bypass", "cabg", "heart bypass", "heart surgery", "dil ka operation"],
  dialysis: ["dialysis", "kidney dialysis", "gurde ki dialysis"],
  appendectomy: ["appendectomy", "appendix", "appendix operation", "appendix surgery", "appendicitis"],
};
const normalizeProcedure = (value) =>
  String(value || "").toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function matchProcedure(value) {
  const normalized = normalizeProcedure(value);
  return DEMO_PROCEDURE_COSTS.find((item) =>
    [item.procedureKey, item.procedureName, ...(PROCEDURE_ALIASES[item.procedureKey] || [])]
      .some((candidate) => normalizeProcedure(candidate) === normalized),
  );
}

function normalizeCity(city) {
  const normalized = String(city || "").trim().toLocaleLowerCase("en-IN");
  return ({ "new delhi": "delhi", bangalore: "bengaluru", gurgaon: "gurugram" })[normalized] || normalized;
}

function acceptsScheme(hospital, scheme) {
  const terms = scheme === "PM-JAY" ? ["pm-jay", "ayushman"] : ["cghs"];
  return (hospital.insuranceAccepted || []).some((entry) =>
    terms.some((term) => String(entry).toLowerCase().includes(term)),
  );
}

function isLocal(hospital, city) {
  if (!city) return true;
  const target = normalizeCity(city);
  return normalizeCity(hospital.city).includes(target) || normalizeCity(hospital.location).includes(target);
}

function distanceKm(origin, destination) {
  if (!origin || !destination) return null;
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(destination.lat - origin.lat);
  const dLng = radians(destination.lng - origin.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function selectDemoCost(procedure, scheme) {
  return {
    procedureKey: procedure.procedureKey,
    procedureName: procedure.procedureName,
    specialty: procedure.specialty,
    unit: procedure.unit,
    privateAverageMin: procedure.privateAverageMin,
    privateAverageMax: procedure.privateAverageMax,
    packageRateReference: procedure.schemeRates[scheme],
    packageCode: "DEMO-ONLY",
    source: "Illustrative development data; not an official scheme rate",
    reviewedAt: null,
    isDemo: true,
  };
}

async function resolveCost(procedure, scheme, city) {
  if (mongoose.connection.readyState === 1) {
    try {
      const cityQuery = city
        ? { $or: [{ city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }, { city: "" }, { city: null }] }
        : {};
      const costQuery = {
        procedureKey: procedure.procedureKey,
        active: true,
        ...cityQuery,
      };
      if (scheme) costQuery.scheme = scheme;
      const record = await ProcedureCost.findOne(costQuery)
        .sort({ city: -1, reviewedAt: -1 })
        .lean();
      if (record) return record;
    } catch (error) {
      console.warn("Procedure cost lookup failed; returning demo estimate:", error.message);
    }
  }
  return selectDemoCost(procedure, scheme);
}

function createCostEstimateRouter({ hospitals }) {
  const router = express.Router();

  router.get("/options", async (req, res) => {
    const city = String(req.query.city || "").trim().slice(0, 100);
    const procedure = matchProcedure(req.query.procedure);
    const localHospitals = hospitals.filter((hospital) => isLocal(hospital, city));
    const rateSchemes = new Set(SCHEMES);
    if (mongoose.connection.readyState === 1 && procedure) {
      try {
        const query = { active: true, procedureKey: procedure.procedureKey };
        if (city) query.city = { $in: [new RegExp("^" + city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), "", null] };
        (await ProcedureCost.distinct("scheme", query)).filter((scheme) => SCHEMES.has(scheme)).forEach((scheme) => rateSchemes.add(scheme));
      } catch (error) {
        console.warn("Could not load city scheme options:", error.message);
      }
    }
    const schemes = [...rateSchemes];
    return res.json({
      success: true,
      procedures: DEMO_PROCEDURE_COSTS.map(({ procedureKey, procedureName, unit }) => ({
        procedureKey,
        procedureName,
        unit,
      })),
      cities: [...new Set(hospitals.map((hospital) => hospital.city).filter(Boolean))].sort(),
      schemes,
    });
  });

  router.post("/", async (req, res) => {
    const { procedureKey, city, isBeneficiary, scheme } = req.body || {};
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const origin = Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180 ? { lat, lng } : null;
    const procedure = PROCEDURES.get(String(procedureKey || "")) || matchProcedure(procedureKey);
    const selectedCity = String(city || "").trim().slice(0, 100);
    const beneficiary = isBeneficiary === true;
    const selectedScheme = String(scheme || "").toUpperCase();

    if (!procedure) {
      return res.status(400).json({
        success: false,
        error: "Choose a procedure from the suggestions or type knee, bypass, dialysis, or appendix.",
        suggestions: DEMO_PROCEDURE_COSTS.map((item) => item.procedureName),
      });
    }
    if (!selectedCity || selectedCity.length < 2) {
      return res.status(400).json({ success: false, error: "Choose a city." });
    }
    if (beneficiary && !SCHEMES.has(selectedScheme)) {
      return res.status(400).json({ success: false, error: "Choose PM-JAY or CGHS as your scheme." });
    }
    try {
      const cost = await resolveCost(procedure, beneficiary ? selectedScheme : null, selectedCity);
      if (beneficiary && (!cost || cost.packageRateReference == null)) {
        return res.status(404).json({
          success: false,
          error: "No package rate is listed for this procedure and scheme in this city. Choose a listed scheme or contact a hospital.",
        });
      }
      const estimateCost = cost || {
            procedureKey: procedure.procedureKey,
            procedureName: procedure.procedureName,
            specialty: procedure.specialty,
            unit: procedure.unit,
            privateAverageMin: procedure.privateAverageMin,
            privateAverageMax: procedure.privateAverageMax,
            packageRateReference: null,
            source: "Illustrative development data; not an official private hospital tariff",
            reviewedAt: null,
            isDemo: true,
          };

      const privateMidpoint = (Number(estimateCost.privateAverageMin) + Number(estimateCost.privateAverageMax)) / 2;
      const referenceRate = estimateCost.packageRateReference == null
        ? Number.NaN
        : Number(estimateCost.packageRateReference);
      const potentialSavings = beneficiary && Number.isFinite(referenceRate)
        ? Math.round(privateMidpoint - referenceRate)
        : null;
      const progressPercent = beneficiary && privateMidpoint > 0 && Number.isFinite(referenceRate)
        ? Math.max(0, Math.min(100, Math.round((referenceRate / privateMidpoint) * 100)))
        : 0;

      const acceptingHospitals = hospitals
        .filter((hospital) => hospital.specialties?.some((specialty) => {
          const listed = String(specialty).toLowerCase();
          const expected = procedure.specialty.toLowerCase();
          return listed.includes(expected) || (expected === "general medicine" && /general surgery|general medicine/.test(listed));
        }))
        .filter((hospital) => isLocal(hospital, selectedCity))
        .filter((hospital) => !beneficiary || acceptsScheme(hospital, selectedScheme))
        .filter((hospital) => {
          if (!beneficiary || !Array.isArray(hospital.empaneledPackages) || !hospital.empaneledPackages.length) return true;
          return hospital.empaneledPackages.some((item) =>
            [procedure.procedureKey, estimateCost.packageCode].some((code) =>
              code && String(item).toLowerCase() === String(code).toLowerCase(),
            ),
          );
        })
        .map((hospital) => {
          const hospitalLat = Number(hospital.coordinates?.lat);
          const hospitalLng = Number(hospital.coordinates?.lng);
          const distance = Number.isFinite(hospitalLat) && Number.isFinite(hospitalLng)
            ? distanceKm(origin, { lat: hospitalLat, lng: hospitalLng })
            : null;
          return {
          id: hospital.id,
          name: hospital.name,
          city: hospital.city,
          location: hospital.location,
          phone: hospital.phone,
          rating: hospital.rating,
          distanceKm: distance,
          schemeAccepted: beneficiary ? selectedScheme : null,
          procedurePackageListed: Array.isArray(hospital.empaneledPackages) && hospital.empaneledPackages.some((item) =>
            [procedure.procedureKey, estimateCost.packageCode].some((code) =>
              code && String(item).toLowerCase() === String(code).toLowerCase(),
            ),
          ),
          mapUrl: `https://www.google.com/maps/dir/?api=1&destination=${hospital.coordinates.lat},${hospital.coordinates.lng}`,
        };})
        .sort((a, b) => origin ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) : (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 12);

      return res.json({
        success: true,
        estimate: {
          procedureKey: procedure.procedureKey,
          procedureName: procedure.procedureName,
          specialty: procedure.specialty,
          unit: procedure.unit,
          city: selectedCity,
          scheme: beneficiary ? selectedScheme : null,
          privateAverage: { min: Number(estimateCost.privateAverageMin), max: Number(estimateCost.privateAverageMax) },
          packageRateReference: beneficiary ? referenceRate : null,
          potentialSavings,
          progressPercent,
          source: estimateCost.source,
          sourceUrl: estimateCost.sourceUrl || "",
          reviewedAt: estimateCost.reviewedAt || null,
          isDemo: Boolean(estimateCost.isDemo),
        },
        hospitals: acceptingHospitals,
        disclaimer: "Illustrative estimates only. Scheme package rates are not a promise of zero out-of-pocket cost or personal savings. Eligibility, authorized package, hospital empanelment, state rules, and non-covered items can change the final bill. Confirm directly with the hospital or scheme helpdesk.",
      });
    } catch (error) {
      console.error("Cost estimate request failed:", error.message);
      return res.status(500).json({ success: false, error: "Could not prepare a cost estimate right now." });
    }
  });

  return router;
}

module.exports = { createCostEstimateRouter };
