# MediGo

MediGo helps people find hospitals, compare care options, read a medical report, and get emergency information. It works on phones and computers.

For an emergency in India, call **108** for an ambulance or **112** for emergency help. MediGo does not send an ambulance or confirm that a hospital has an open bed.

## What the app can do

- Find hospitals by health concern and area. Allow location access to sort by distance, or type a city.
- Show hospital locations on a map, with phone and direction links.
- Show nearby emergency hospitals first when location is available. Call to confirm current availability.
- Compare hospitals and save a list in this browser.
- Estimate costs for knee replacement, bypass surgery, dialysis, and appendix surgery.
- Show government health scheme information for a selected city.
- Read a clear photo of a medical report and explain what it says.
- Answer general health questions in English, Hindi, Hinglish, or Punjabi.

The cost examples are for development and are not official prices. Confirm costs and scheme eligibility with the hospital or scheme helpline. The report reader is not a diagnosis. A doctor should review medical decisions.

## Run MediGo on your computer

You need Node.js 20 or newer and MongoDB.

1. Open a terminal in `MediGo-Backend`.
2. Install packages: `npm install`.
3. Copy `.env.example` to `.env` and add the settings you have.
4. Start the app: `npm start`.
5. Open `http://localhost:3000`.

The frontend files are in `MediGo-Frontend/public`. When the two folders are side by side, the backend serves those files automatically.

## Settings

Add these values to `.env` when you use the related feature:

- `MONGODB_URI` — stores hospital and reviewed cost data.
- `JWT_SECRET` — protects administrative tools. Use a long, private value.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` — sends emergency preparation emails. `SMTP_URL` can be used instead.
- `GEMINI_API_KEY` — enables AI chat and report reading.
- `GEOAPIFY_API_KEY` — optional, helps turn GPS coordinates into a readable address.
- `CORS_ORIGINS` — allowed website addresses when frontend and backend are hosted separately.

Keep `.env` private. Do not put these keys in frontend JavaScript.

## Public access

Hospital search, nearby discovery, cost estimates, government scheme lookup, chat, report reading, comparison, and reviews are available without creating an account. AI tools need a valid `GEMINI_API_KEY`. Location-based results need GPS permission or a city name.

## Location and maps

The browser asks permission before sharing GPS coordinates. Use the site over HTTPS on a phone; browsers block location on ordinary HTTP websites. If location is off or denied, type a city instead. Maps need an internet connection to load map tiles.

## Treatment cost data

The app can use verified records in MongoDB's `procedure_costs` collection. If no matching record exists, it displays clearly labelled development examples from `data/procedure-costs.js`. Do not present those examples as current hospital prices or guaranteed scheme rates.

To load the example records into a local database, run `npm run seed:procedure-costs` from `MediGo-Backend`.

## Main folders

- `MediGo-Frontend/public/index.html` — home page and health tools.
- `MediGo-Frontend/public/emergency.html` — emergency contacts and nearby hospitals.
- `MediGo-Frontend/public/results.html` — hospital search results and map.
- `MediGo-Backend/server.js` — web server and API.
- `MediGo-Backend/routes/` — cost estimate and report reader APIs.
- `MediGo-Backend/models/` — MongoDB data models.

## Important limits

- Hospital phone numbers, services, bed counts, and map listings can be incomplete or out of date. Call before travelling.
- A hospital preparation email is only a message; it does not mean the hospital received it or is ready.
- AI summaries can make mistakes. Ask a qualified health professional about your care.
- Emergency calling and the public health tools do not require an account.
