# MediGo: Current Issues

This file tracks problems observed while running the local project. It is separate from the GitHub project README and is not displayed in the website.

## Previously observed in the September 23 server screenshot

| Problem | Observed result | What is affected |
| --- | --- | --- |
| MongoDB connection fails | Server logs show all four connection attempts failed (`8000`), followed by “MongoDB is unavailable after retries.” | MongoDB-backed features such as saved user accounts and database-backed hospital data may fail or use limited fallback data. |
| SMTP authentication fails | Server logs show `SMTP connection failed: AUTH`. | Email-based alerts and other email delivery features will not send successfully. |
| Server process appears to exit | The log prints `MediGo API listening on 0.0.0.0:3000`, but the terminal prompt returns. | The API may no longer be running when the browser tries to contact it. The listening message alone does not confirm it stayed running. |
| MediGo AI reports offline | The chat window displays `MediGo AI (offline)` and says Gemini could not be reached. | Live Gemini chat responses are unavailable; the app may show its fallback response instead. |

## Features that depend on those services

- Gemini-powered chat and medical report image analysis need a working Gemini API key and network access.
- Emergency email notifications need valid SMTP settings and a reachable mail server. The SOS screen can still provide a map link and the 108 call option; an email failure does not mean an ambulance has been dispatched.
- Features that require MongoDB data may be unavailable while the database connection is failing. Some routes provide in-memory or bundled demo fallbacks, so displayed data may be limited and may not persist after restart.
- Any frontend feature that calls the local API will fail while the backend process is stopped or unreachable.

## Not confirmed by the screenshot

The screenshot does not establish whether GPS permission, reverse geocoding, the PWA offline cache, report image upload, or cost-estimate fallback data work correctly. Check these separately before treating them as broken.

## Current configuration check

MongoDB, Gemini, Geoapify, and SMTP credential fields are now populated in the ignored local `.env`; secret values are intentionally not recorded here. `EMERGENCY_HOSPITAL_EMAIL` is still missing, so SOS email has no recipient configured. The server reports explicit bind errors and does not wait for MongoDB before starting.

Connection checks from the restricted coding environment could not reach MongoDB or Gemini, and local HTTP port binding was denied (`EPERM`). This does not establish whether the credentials work on the user's computer. Restart locally with `npm start` and check `http://localhost:3000/api/health`; `database` reports the MongoDB state, while `geminiConfigured` means a key is present and `geminiStatus` changes to `connected` or `error` after an AI request.

The old example environment file contained credential-like values. It has been replaced with empty placeholders. Rotate any old MongoDB, Gemini, or Geoapify credentials in their provider dashboards. Do not paste secret keys into chat or commit `.env`.

For MongoDB Atlas, use its application connection string, ensure the database user and password are valid, URL-encode special characters in the password, and allow your current IP in Atlas Network Access. Gemini chat and report analysis both use the backend `GEMINI_API_KEY`; the configured model is `gemini-3.8-flash` with supported fallbacks.
