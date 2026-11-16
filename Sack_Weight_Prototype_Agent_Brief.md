# Build brief: grain sack weight estimation prototype

You are building a small prototype to test one question: **can a vision LLM, called through OpenRouter, estimate the weight of a single grain sack from one photo accurately enough to be useful?** This is the weight-estimation part of a final year project (Smart Grain Warehouse, Tanzania). Everything else in the project (database, dashboard, price assistant, offline queue) is out of scope here.

The prototype is a test rig, not a product. Prioritise: (1) getting a working estimate quickly, (2) logging results against true weights so accuracy can be measured honestly, (3) clean, simple code. Skip anything not listed below.

## Stack

- Frontend: React + Vite (plain JavaScript is fine).
- Backend: small Node.js + Express server. The OpenRouter API key must live **only** on the server, in `.env` (`OPENROUTER_API_KEY`). Never expose it to the browser, never log it, never commit it. Provide `.env.example` and a `.gitignore` that excludes `.env`, `node_modules` and `data/`.
- Storage: plain JSON file at `data/results.json` (and uploaded test photos in `data/photos/`). No database.
- One command to run everything: `npm run dev` (use `concurrently`; Vite proxies `/api` to Express).
- Keep dependencies minimal.

## OpenRouter API (verify against the current docs before coding)

- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`, header `Authorization: Bearer <key>`, OpenAI-compatible body.
- Images: message `content` array with `{ "type": "text", "text": "..." }` and `{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }`.
- Structured output: `response_format: { "type": "json_schema", "json_schema": { "name": "...", "strict": true, "schema": {...} } }`.
- Not every model supports images and structured outputs. Do **not** pick model IDs from memory. Check https://openrouter.ai/models (filter: image input + `structured_outputs` supported parameter) and the OpenRouter docs, then put 3 to 4 current candidates in `config/models.json`: one strong, one mid-range, one cheap. Make the model selectable in the UI. Also check in the docs whether `provider.require_parameters: true` is supported, and use it if so, so requests only route to providers that honour the schema.
- Record `usage` (tokens, and cost if returned) and latency for every call.

## Config files

`config/crops.json` (editable, loaded by the server and sent to the UI). The numbers below are **placeholders to be confirmed by the user**; mark them as such in a `"note"` field.

```json
{
  "plausible_range": { "min_factor": 0.7, "max_factor": 1.1 },
  "crops": [
    { "id": "maize",   "label": "Maize",   "nominal_kg_options": [50, 100], "bulk_density_kg_m3": 750, "note": "placeholder" },
    { "id": "beans",   "label": "Beans",   "nominal_kg_options": [50, 100], "bulk_density_kg_m3": 780, "note": "placeholder" },
    { "id": "rice",    "label": "Rice",    "nominal_kg_options": [50, 100], "bulk_density_kg_m3": 800, "note": "placeholder" },
    { "id": "sorghum", "label": "Sorghum", "nominal_kg_options": [50, 100], "bulk_density_kg_m3": 740, "note": "placeholder" }
  ]
}
```

Plausible weight range for a sack = nominal x min_factor to nominal x max_factor.

## Screens

Two tabs in a single page.

### Tab 1: Estimate

1. Controls: crop (dropdown), nominal sack size in kg (dropdown from the crop's options), model (dropdown from `models.json`), prompt variant (`plain` or `marker`), number of runs (default 3), and a "reference marker in frame" checkbox with marker size text (default "A4 sheet, 21 x 29.7 cm"; only used by the `marker` variant).
2. Photo input: `<input type="file" accept="image/*" capture="environment">` so it opens the camera on a phone, plus drag-and-drop on desktop. Show a preview.
3. Client side, before upload: resize so the longest side is at most 1280 px, re-encode as JPEG quality 0.85, and compute a SHA-256 hash of the resized image.
4. Button "Estimate weight". Show a loading state. Then show:
   - Final recorded weight (kg), status badge **Accepted** or **Needs review**, and the list of reasons if it needs review.
   - Model direct estimate (median kg) and the difference from the final weight in percent.
   - Each individual run in a small table: fill_factor, estimated_weight_kg, range, confidence, image_issues, reasoning, latency, cost.
   - Warning if this image hash was already submitted (duplicate check against `results.json`).
5. Optional field "Actual weight (kg)" and a button "Save to test log". Saving stores the photo, all inputs, all run outputs, final result and actual weight. Saving without an actual weight is allowed but flagged as "no ground truth".

### Tab 2: Results

- Table of all saved tests (thumbnail, crop, nominal, model, variant, final kg, direct kg, actual kg, error kg, error %, status). Row delete button.
- Metrics, computed only on rows that have an actual weight, shown overall and per crop and per model and per variant:
  - Count, MAE (kg), MAPE (%), bias (mean signed error, kg), share of sacks within +/-5% and within +/-10%.
  - **Naive baseline**: always predict the nominal weight. Show its MAE and MAPE next to the model's, because real sacks are often close to nominal and the model must beat this baseline to be worth using.
  - Same metrics for the direct-estimate method (median of `estimated_weight_kg`) versus the fill-factor method (nominal x median `fill_factor`), so the two methods can be compared.
- "Export CSV" button.

## Server endpoint

`POST /api/estimate` with JSON `{ imageBase64, mimeType, cropId, nominalKg, modelId, variant, runs, markerInFrame, markerDescription }`.

Behaviour:

1. Validate inputs. Reject images over 5 MB. Look up the crop in `crops.json`.
2. Build the prompt (below) and call OpenRouter `runs` times **in parallel** (default 3, temperature 0.3).
3. Parse each response as JSON against the schema. If a run returns invalid JSON, retry that run once, then mark it failed. If all runs fail, return a clear error.
4. Aggregate over successful runs: median of `fill_factor`, median of `estimated_weight_kg`, median confidence, union of `image_issues`.
5. Final weight = `nominalKg x median fill_factor`. Direct estimate = median `estimated_weight_kg`.
6. Review rules. Status is **Needs review** if any of these is true, and every triggered reason is returned:
   - final weight outside the plausible range for the crop
   - median confidence below 0.5
   - `image_issues` non-empty (other than "none")
   - direct estimate and final weight differ by more than 15 percent
   - `crop_matches_declared` is false in at least half of the runs (a soft check only, because tied sacks hide their contents)
   - fewer than half of the runs succeeded
7. Return everything to the UI. Do not store anything until the user clicks "Save to test log" (`POST /api/results`). Provide `GET /api/results`, `DELETE /api/results/:id` and `GET /api/results.csv`.

## Output schema (strict JSON schema sent to the model)

All fields required.

| Field | Type | Meaning |
|---|---|---|
| `sack_visible` | boolean | One sack clearly visible |
| `crop_guess` | string | Crop the model believes is in the sack, or "unknown" |
| `crop_matches_declared` | boolean or null | null if it cannot tell |
| `marker_visible` | boolean | Reference marker visible in frame |
| `fill_factor` | number | 1.0 = a full nominal sack, below 1 = partly filled, above 1 = overfilled. Range 0.3 to 1.3 |
| `estimated_weight_kg` | number | Direct weight estimate in kg |
| `range_low_kg` | number | Lower bound |
| `range_high_kg` | number | Upper bound |
| `confidence` | number | 0 to 1 |
| `image_issues` | array of enum | `blurry`, `too_dark`, `too_far`, `cut_off`, `glare`, `multiple_sacks`, `no_sack`, `none` |
| `reasoning` | string | Two sentences at most, naming the visual cues used |

## Prompts

Keep prompts in `server/prompts.js` with a `PROMPT_VERSION` string that is saved with every result. Two variants:

**System prompt (both variants)**

> You estimate the weight of a single sack of grain from a photograph for a warehouse in Tanzania. You are not a scale. Give a careful estimate with an honest uncertainty range, and lower your confidence when the photo is poor. Respond only with JSON that matches the provided schema.

**User prompt, `plain` variant**

> Declared crop: {crop}. Nominal sack size: {nominal} kg (a completely full standard sack). Typical weight range for this sack: {min} to {max} kg.
> Judge how full and firm the sack looks compared with a full {nominal} kg sack, using its overall size, bulging versus slack or folded fabric, and how it stands or sits. Report fill_factor (1.0 = exactly nominal) and your direct weight estimate in kg. If the sack is not clearly visible, or there is more than one sack, list that in image_issues and lower confidence. Do not guess beyond what is visible.

**User prompt, `marker` variant**: the same text plus:

> A {marker description} has been placed next to the sack as a size reference. Use it to judge the real dimensions of the sack. If the marker is not visible, set marker_visible to false and lower confidence.

Both variants send the image as a separate `image_url` content part after the text.

## Project structure

```
sack-weight-prototype/
  package.json
  .env.example
  .gitignore
  config/crops.json
  config/models.json
  server/index.js        (Express, endpoints)
  server/openrouter.js   (API call, retry, JSON parsing)
  server/prompts.js
  server/metrics.js      (MAE, MAPE, bias, within-X percent, baseline)
  data/                  (results.json, photos/; git-ignored)
  src/                   (React app: Estimate tab, Results tab)
  README.md              (setup and how to run, 10 lines max)
```

## Out of scope (do not build)

Authentication, Supabase or any database, PWA or offline queue, price assistant, dashboard, multi-sack photos, model training, deployment.

## Acceptance checklist

1. `npm install` then `npm run dev` starts frontend and backend with only `OPENROUTER_API_KEY` set in `.env`.
2. Taking or uploading a photo, choosing crop and nominal size, and pressing Estimate returns a result in under about 20 seconds with all runs shown.
3. The API key never appears in browser network calls, console output, the repo or the data files.
4. Invalid JSON from the model and API errors are handled and shown clearly, without crashing the server.
5. Saving a test with an actual weight adds it to the Results tab, and the metrics (including the naive nominal-weight baseline) update correctly. Check `metrics.js` with a few hand-computed examples.
6. CSV export opens correctly in Excel.
7. Changing the model or the prompt variant works without code changes.

When finished, give a short summary of what was built, the models chosen and why, anything you could not verify, and the exact commands to run it.

---

## How the user will run the viability test (for reference, not for the agent)

- Collect at least 30 sacks per crop, with deliberately varied fill (full, a bit under, clearly under), not only perfect ones. A model that always answers "full" looks good on uniform sacks, which is why the baseline comparison matters.
- Weigh every sack on a reference scale and enter the actual weight.
- Photograph each sack the same way: same distance, same angle, whole sack in frame, reference marker beside it, plain background, good light.
- Run the same photos through each candidate model and both prompt variants.
- Rough decision guide: if the model does not clearly beat the naive baseline, the approach is not viable as designed. If MAPE is around 10 percent or better with most sacks within +/-10 percent and low bias, it is a promising basis for the proposal. These thresholds are suggestions to adjust with your supervisor.
