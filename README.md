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

- `MONGODB_URI` — stores accounts, email verification codes, and reviewed cost data.
- `JWT_SECRET` — protects signed-in sessions. Use a long, private value.
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` — sends email login codes and password reset codes. `SMTP_URL` can be used instead.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` — optional SMS delivery for signup and login codes.
- `GEMINI_API_KEY` — enables AI chat and report reading.
- `GEOAPIFY_API_KEY` — optional, helps turn GPS coordinates into a readable address.
- `CORS_ORIGINS` — allowed website addresses when frontend and backend are hosted separately.

Keep `.env` private. Do not put these keys in frontend JavaScript.

## Sign-in codes

Login and signup codes are sent by email. To send them by SMS instead, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`; include the country code in the phone number (for example, `+91`). Password reset codes continue to use email. The server saves a hashed code in MongoDB for up to five minutes, limits wrong attempts, and accepts only the latest code. MongoDB and at least one delivery method (SMTP or Twilio) must be available.

## Location and maps

The browser asks permission before sharing GPS coordinates. Use the site over HTTPS on a phone; browsers block location on ordinary HTTP websites. If location is off or denied, type a city instead. Maps need an internet connection to load map tiles.

## Treatment cost data

The app can use verified records in MongoDB's `procedure_costs` collection. If no matching record exists, it displays clearly labelled development examples from `data/procedure-costs.js`. Do not present those examples as current hospital prices or guaranteed scheme rates.

To load the example records into a local database, run `npm run seed:procedure-costs` from `MediGo-Backend`.

## Main folders

- `MediGo-Frontend/public/index.html` — home page and health tools.
- `MediGo-Frontend/public/auth.html` — login and signup.
- `MediGo-Frontend/public/emergency.html` — emergency contacts and nearby hospitals.
- `MediGo-Frontend/public/results.html` — hospital search results and map.
- `MediGo-Backend/server.js` — web server and API.
- `MediGo-Backend/routes/` — cost estimate and report reader APIs.
- `MediGo-Backend/models/` — MongoDB data models.

## Important limits

- Hospital phone numbers, services, bed counts, and map listings can be incomplete or out of date. Call before travelling.
- A hospital preparation email is only a message; it does not mean the hospital received it or is ready.
- AI summaries can make mistakes. Ask a qualified health professional about your care.
- Emergency calling works without signing in. Other account features need a MediGo account.
