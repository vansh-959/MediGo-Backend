const mongoose = require("mongoose");

// This model supports deployments that store the hospital directory in MongoDB.
// The existing MediGo directory remains a fallback until MongoDB is populated.
const hospitalSchema = new mongoose.Schema(
  {
    id: String,
    name: { type: String, required: true },
    city: String,
    location: String,
    specialties: [String],
    coordinates: {
      lat: Number,
      lng: Number,
    },
    phone: String,
    rating: Number,
    emergencyBedsAvailable: Number,
    icuAvailable: Number,
  },
  { strict: false, collection: "hospitals" },
);

module.exports =
  mongoose.models.Hospital || mongoose.model("Hospital", hospitalSchema);
