# Grain Weight Lab

A small prototype for studying whether a vision model can estimate the weight of one grain sack from a photo. It is designed to compare estimates against readings from a reference scale for the Smart Grain Warehouse project in Tanzania.

This is an experimental test rig. **A model estimate is not a substitute for a calibrated scale.** Crop details and plausible weight ranges are placeholders that need to be confirmed with local measurements.

## Features

- Capture a photo on a phone or upload one from a computer.
- Resize the image in the browser (longest side 1280 px, JPEG quality 0.85) and calculate a SHA-256 hash for duplicate detection.
- Compare three configurable OpenRouter vision models, two prompt variants, and one to five independent runs.
- Review the fill-factor estimate, direct model estimate, uncertainty ranges, confidence, image issues, latency, token usage, and reported cost.
- Save each test with an optional actual scale weight. Results without a scale reading are flagged as having no ground truth.
- Compare model accuracy with the naive baseline that always predicts the nominal sack weight; export saved results as a PDF with photos.
- Store saved results and photos locally during development, and in private Vercel Blob storage when deployed.

## Requirements

- Node.js 20 or later
- An OpenRouter API key with access to at least one configured model

## Setup

1. Clone this repository and open its folder in a terminal.
2. Copy `.env.example` to `.env` and add your key:

   ```env
   OPENROUTER_API_KEY=your_openrouter_api_key
   ```

3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

4. Open the Vite URL printed in the terminal, usually [http://localhost:5173](http://localhost:5173).

The Express API listens on port `3001`; Vite proxies `/api` requests to it. If port `5173` is already occupied, Vite will print the alternate URL it selected.

## Using the prototype

1. In **Estimate**, choose a crop, nominal sack size, vision model, prompt variant, and number of runs.
2. Add one clear photo of a single sack. The marker variant can use a reference marker such as an A4 sheet.
3. Select **Estimate weight**. The final result is the mean of successful direct model weight estimates. The median direct estimate and individual run outputs remain visible as diagnostics. Fill factors can range down to zero, so underfilled sacks can estimate below 15 kg.
4. Enter the measured scale weight if available, then save the test to the log.
5. Open **Test results** to review saved tests, compare performance with the nominal-weight baseline, and export a PDF copy of the table with its photos.

Accuracy metrics only include tests with an actual scale weight. The app reports count, MAE, MAPE, bias, and the share within ±5% and ±10%, overall and grouped by crop, model, and prompt variant.

## Models and configuration

The current model candidates are listed in [`config/models.json`](config/models.json):

- **Kimi K2.5** — strong quality reference
- **Gemini 3.8 Flash** — balanced quality and speed
- **Tencent Hy4 Flash** — low-cost candidate

Model IDs and availability can change. Check the current [OpenRouter model catalog](https://openrouter.ai/models) before replacing or adding models. Candidates were selected for image input, structured-output support, and temperature support. Requests use strict JSON Schema output and ask OpenRouter to route only to providers that support the requested parameters.

Crop options, nominal sack sizes, bulk densities, and plausible weight factors are in [`config/crops.json`](config/crops.json). Values marked `placeholder` are starting assumptions, not validated Tanzanian grain measurements.

## Local data and API key

- The API key is read by the Express server from `.env`. The provided local `openrouter.env` file is also accepted as a fallback.
- The key is never sent to the browser. Keep `.env` and `openrouter.env` private; do not commit either file.
- Images are sent to OpenRouter when an estimate is requested. The app does not save a photo until **Save to test log** is selected.
- Locally, saved photos and results go to `data/photos/` and `data/results.json`. The whole `data/` directory is ignored by Git. Vercel uses a private Blob store because function filesystems are temporary.
- `.gitignore` also excludes `node_modules/` and build output. Commit `.env.example`, not a populated `.env` file.

## Vercel deployment

The root `index.js` exports the Express app so Vercel can deploy the API as a Function. Vite's production build writes the frontend to `public/`, which Vercel serves from its CDN. Run `npm run build` after changing the frontend and include the updated `public/` assets in the deployment.

The Vercel project should use the **Express** framework preset so the API is deployed as a Function. Set these up for the project:

- `OPENROUTER_API_KEY`: add this as a private environment variable for Production (and Preview if needed). Never commit the key or expose it as a `VITE_` variable.
- A **private Vercel Blob** store connected to the project: Vercel supplies the Blob store environment automatically. This holds saved test photos and result records across deployments.

After connecting the store and confirming the OpenRouter key is set, redeploy the project. The app's API and saved-results routes then run through the Express Function.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Read crop and model options |
| `POST` | `/api/estimate` | Estimate a sack from an image |
| `GET` | `/api/results` | Read saved tests and accuracy metrics |
| `POST` | `/api/results` | Save a test and its photo |
| `DELETE` | `/api/results/:id` | Delete a test and its photo |
| `GET` | `/api/results.csv` | Download the saved test log |

## Project structure

```text
config/       Crop and model configuration
server/       Express API, OpenRouter client, prompts, and metrics
src/          React interface
data/         Local test results and photos (created at runtime; Git-ignored)
```
