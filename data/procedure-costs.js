// Demonstration-only values for local development. Replace with rates verified
// for the relevant scheme, state, city, hospital class, and validity period.
const DEMO_PROCEDURE_COSTS = [
  {
    procedureKey: "knee-replacement",
    procedureName: "Knee Replacement",
    specialty: "Orthopedics",
    unit: "procedure",
    privateAverageMin: 180000,
    privateAverageMax: 320000,
    schemeRates: { "PM-JAY": 80000, CGHS: 150000 },
  },
  {
    procedureKey: "bypass-surgery",
    procedureName: "Bypass Surgery (CABG)",
    specialty: "Cardiology",
    unit: "procedure",
    privateAverageMin: 300000,
    privateAverageMax: 550000,
    schemeRates: { "PM-JAY": 175000, CGHS: 280000 },
  },
  {
    procedureKey: "dialysis",
    procedureName: "Hemodialysis",
    specialty: "Nephrology",
    unit: "session",
    privateAverageMin: 2500,
    privateAverageMax: 5000,
    schemeRates: { "PM-JAY": 1500, CGHS: 2200 },
  },
  {
    procedureKey: "appendectomy",
    procedureName: "Appendectomy",
    specialty: "General Medicine",
    unit: "procedure",
    privateAverageMin: 60000,
    privateAverageMax: 150000,
    schemeRates: { "PM-JAY": 35000, CGHS: 65000 },
  },
];

module.exports = { DEMO_PROCEDURE_COSTS };
