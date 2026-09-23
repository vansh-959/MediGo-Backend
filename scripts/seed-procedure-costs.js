require("dotenv").config();
const mongoose = require("mongoose");
const ProcedureCost = require("../models/ProcedureCost");
const { DEMO_PROCEDURE_COSTS } = require("../data/procedure-costs");

async function seedProcedureCosts() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
  await mongoose.connect(process.env.MONGODB_URI);

  const operations = DEMO_PROCEDURE_COSTS.flatMap((procedure) =>
    Object.entries(procedure.schemeRates).map(([scheme, packageRateReference]) => ({
      updateOne: {
        filter: { procedureKey: procedure.procedureKey, scheme, city: "" },
        update: {
          $set: {
            procedureName: procedure.procedureName,
            specialty: procedure.specialty,
            unit: procedure.unit,
            privateAverageMin: procedure.privateAverageMin,
            privateAverageMax: procedure.privateAverageMax,
            packageRateReference,
            packageCode: "DEMO-ONLY",
            source: "Illustrative development data; not an official scheme rate",
            reviewedAt: null,
            isDemo: true,
            active: true,
          },
        },
        upsert: true,
      },
    })),
  );

  const result = await ProcedureCost.bulkWrite(operations);
  console.log(`Procedure cost seed complete: ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`);
  await mongoose.disconnect();
}

seedProcedureCosts().catch(async (error) => {
  console.error("Could not seed procedure costs:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
