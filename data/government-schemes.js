const GOVERNMENT_SCHEMES = [
  {
    id: "pm-jay",
    name: "Ayushman Bharat PM-JAY",
    coverage: "Cashless hospital care up to ₹5 lakh per family per year",
    helpline: "14555",
    url: "https://nha.gov.in/PM-JAY",
    match: ["pm-jay", "ayushman"],
    states: ["all"],
  },
  {
    id: "cghs",
    name: "CGHS",
    coverage: "Central Government Health Scheme for eligible central government employees and pensioners",
    helpline: "011-21465812",
    url: "https://cghs.mohfw.gov.in/",
    match: ["cghs"],
    states: ["all"],
  },
  {
    id: "esic",
    name: "ESIC",
    coverage: "Medical care for insured workers and dependents under ESIC",
    helpline: "1800-112-526",
    url: "https://www.esic.gov.in/",
    match: ["esic"],
    states: ["all"],
  },
  {
    id: "sarbat-sehat",
    name: "Sarbat Sehat Bima Yojana",
    coverage: "Punjab state health insurance for eligible families",
    helpline: "104",
    url: "https://ssby.punjab.gov.in/",
    match: ["sarbat"],
    states: ["punjab", "chandigarh"],
  },
  {
    id: "mjpjay",
    name: "Mahatma Jyotiba Phule Jan Arogya Yojana",
    coverage: "Maharashtra cashless care for eligible families",
    helpline: "1800-233-2200",
    url: "https://www.jeevandayee.gov.in/",
    match: ["mjpjay", "jyotiba", "jeevandayee"],
    states: ["maharashtra"],
  },
  {
    id: "ab-pmjay-delhi",
    name: "Delhi Arogya Kosh / PM-JAY network",
    coverage: "Cashless care through empaneled hospitals in Delhi",
    helpline: "104",
    url: "https://dgehs.delhi.gov.in/",
    match: ["ayushman", "arogya"],
    states: ["delhi"],
  },
];

const CITY_STATE = {
  chandigarh: "chandigarh",
  mohali: "punjab",
  "sahibzada ajit singh nagar": "punjab",
  ludhiana: "punjab",
  amritsar: "punjab",
  jalandhar: "punjab",
  patiala: "punjab",
  delhi: "delhi",
  "new delhi": "delhi",
  gurugram: "haryana",
  gurgaon: "haryana",
  noida: "uttar pradesh",
  mumbai: "maharashtra",
  pune: "maharashtra",
  nagpur: "maharashtra",
  bengaluru: "karnataka",
  bangalore: "karnataka",
  hyderabad: "telangana",
  chennai: "tamil nadu",
  kolkata: "west bengal",
  jaipur: "rajasthan",
  ahmedabad: "gujarat",
  lucknow: "uttar pradesh",
};

function normalizePlace(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-IN");
}

function stateForCity(city) {
  const key = normalizePlace(city);
  return CITY_STATE[key] || CITY_STATE[key.replace(/\s+/g, " ")] || "";
}

function schemesForCity(city) {
  const state = stateForCity(city);
  return GOVERNMENT_SCHEMES.filter(
    (scheme) => scheme.states.includes("all") || (state && scheme.states.includes(state)),
  );
}

module.exports = { GOVERNMENT_SCHEMES, CITY_STATE, schemesForCity, stateForCity, normalizePlace };
