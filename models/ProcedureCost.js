const mongoose = require("mongoose");

const procedureCostSchema = new mongoose.Schema(
  {
    procedureKey: { type: String, required: true, index: true },
    procedureName: { type: String, required: true },
    specialty: { type: String, required: true },
    unit: { type: String, default: "procedure" },
    city: { type: String, default: "" },
    scheme: { type: String, trim: true, required: true },
    privateAverageMin: { type: Number, required: true, min: 0 },
    privateAverageMax: { type: Number, required: true, min: 0 },
    packageRateReference: { type: Number, required: true, min: 0 },
    packageCode: { type: String, default: "" },
    source: { type: String, required: true },
    sourceUrl: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    isDemo: { type: Boolean, default: false },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "procedure_costs" },
);

module.exports =
  mongoose.models.ProcedureCost || mongoose.model("ProcedureCost", procedureCostSchema);
