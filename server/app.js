import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildPrompt, PROMPT_VERSION } from './prompts.js';
import { runEstimate } from './openrouter.js';
import { metricSets, compareMethods } from './metrics.js';
import { initializeStorage, readResults, saveResult, deleteResult, readPhoto } from './storage.js';
import crops from '../config/crops.json' with { type: 'json' };
import models from '../config/models.json' with { type: 'json' };

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });
if (!process.env.OPENROUTER_API_KEY) dotenv.config({ path: path.join(root, 'openrouter.env') });
const app = express();
app.use(express.json({ limit: '8mb' }));
await initializeStorage();

app.get('/', (_req, res) => res.redirect(307, '/index.html'));

app.get('/api/config', (_req, res) => res.json({ ...crops, models: models.models }));

app.post('/api/estimate', async (req, res) => {
  try {
    const { imageBase64, mimeType, cropId, nominalKg, modelId, variant, runs = 3, markerInFrame = false, markerDescription = 'A4 sheet, 21 x 29.7 cm', imageHash } = req.body || {};
    if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'OPENROUTER_API_KEY is missing. Add it to .env and restart the server.' });
    const crop = crops.crops.find((item) => item.id === cropId);
    if (!crop) return res.status(400).json({ error: 'Choose a valid crop.' });
    if (!crop.nominal_kg_options.includes(Number(nominalKg))) return res.status(400).json({ error: 'Choose a valid nominal sack size for this crop.' });
    if (!models.models.some((item) => item.id === modelId)) return res.status(400).json({ error: 'Choose a valid model.' });
    if (!['plain', 'marker'].includes(variant)) return res.status(400).json({ error: 'Prompt variant must be plain or marker.' });
    if (variant === 'marker' && typeof markerDescription !== 'string') return res.status(400).json({ error: 'Marker description must be text.' });
    const runCount = Number(runs);
    if (!Number.isInteger(runCount) || runCount < 1 || runCount > 5) return res.status(400).json({ error: 'Number of runs must be between 1 and 5.' });
    if (typeof imageBase64 !== 'string' || !/^image\/(jpeg|png|webp)$/.test(mimeType || '')) return res.status(400).json({ error: 'Upload a JPEG, PNG, or WebP image.' });
    const encoded = imageBase64.replace(/^data:[^,]+,/, '');
    const image = Buffer.from(encoded, 'base64');
    if (!image.length || image.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image is empty or larger than 5 MB. Choose a smaller image.' });
    const hash = typeof imageHash === 'string' ? imageHash : '';
    const prior = hash ? (await readResults()).some((row) => row.imageHash === hash) : false;
    const nominal = Number(nominalKg);
    const range = crops.plausible_range;
    const prompt = buildPrompt({ crop: crop.label, nominalKg: nominal, minKg: nominal * range.min_factor, maxKg: nominal * range.max_factor, variant, markerDescription, markerInFrame });
    const dataUrl = `data:${mimeType};base64,${encoded}`;
    const outputs = await Promise.all(Array.from({ length: runCount }, () => runEstimate({ apiKey: process.env.OPENROUTER_API_KEY, modelId, prompt, dataUrl })));
    const successful = outputs.filter((output) => !output.failed);
    if (!successful.length) return res.status(502).json({ error: `All ${runCount} model runs failed. ${outputs[0]?.error || 'Try again.'}`, runs: outputs });
    const median = (values) => { const ordered = [...values].sort((a, b) => a - b); const mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2; };
    const fillFactor = median(successful.map((item) => item.fill_factor));
    const directWeightKg = median(successful.map((item) => item.estimated_weight_kg));
    const finalWeightKg = nominal * fillFactor;
    const confidence = median(successful.map((item) => item.confidence));
    const imageIssues = [...new Set(successful.flatMap((item) => item.image_issues).filter((issue) => issue !== 'none'))];
    const reasons = [];
    const min = nominal * range.min_factor;
    const max = nominal * range.max_factor;
    if (finalWeightKg < min || finalWeightKg > max) reasons.push(`Final estimate is outside the plausible ${min.toFixed(1)}–${max.toFixed(1)} kg range.`);
    if (confidence < 0.5) reasons.push('Median model confidence is below 0.50.');
    if (imageIssues.length) reasons.push(`Image issues reported: ${imageIssues.join(', ')}.`);
    if (Math.abs(directWeightKg - finalWeightKg) / Math.max(finalWeightKg, 0.001) > 0.15) reasons.push('Direct estimate and fill-factor estimate differ by more than 15%.');
    if (successful.filter((item) => item.crop_matches_declared === false).length >= Math.ceil(runCount / 2)) reasons.push('At least half of requested runs think the crop may not match the selection.');
    if (successful.length < runCount / 2) reasons.push('Fewer than half of requested runs succeeded.');
    return res.json({ imageHash: hash, duplicate: prior, cropId, cropLabel: crop.label, nominalKg: nominal, modelId, modelLabel: models.models.find((item) => item.id === modelId).label, variant, markerInFrame: Boolean(markerInFrame), markerDescription, runs: outputs, successfulRuns: successful.length, fillFactor, directWeightKg, finalWeightKg, confidence, imageIssues, status: reasons.length ? 'Needs review' : 'Accepted', reasons, promptVersion: PROMPT_VERSION, plausibleRangeKg: { min, max } });
  } catch (error) {
    console.error('Estimate request failed:', error.message);
    return res.status(500).json({ error: 'The estimate could not be completed. Check the server connection and try again.' });
  }
});

app.get('/api/results', async (_req, res) => {
  try {
    const rows = await readResults();
    const grounded = rows.filter((row) => Number.isFinite(Number(row.actualWeightKg)) && Number(row.actualWeightKg) > 0);
    return res.json({ rows, metrics: metricSets(rows), comparisons: compareMethods(grounded) });
  } catch (error) {
    console.error('Load results failed:', error.message);
    return res.status(503).json({ error: 'Saved results storage is unavailable. Connect the project’s private Vercel Blob store and try again.' });
  }
});

app.post('/api/results', async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.estimate || typeof payload.imageBase64 !== 'string') return res.status(400).json({ error: 'Estimate and image data are required to save a result.' });
    const { estimate } = payload;
    const encoded = payload.imageBase64.replace(/^data:[^,]+,/, '');
    const photo = Buffer.from(encoded, 'base64');
    if (!photo.length || photo.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Photo is empty or larger than 5 MB.' });
    const actualWeightKg = payload.actualWeightKg === '' || payload.actualWeightKg == null ? null : Number(payload.actualWeightKg);
    if (actualWeightKg !== null && (!Number.isFinite(actualWeightKg) || actualWeightKg <= 0)) return res.status(400).json({ error: 'Actual weight must be a positive number.' });
    const id = randomUUID();
    const photoName = `${id}.jpg`;
    const row = { id, createdAt: new Date().toISOString(), photo: photoName, imageHash: estimate.imageHash, cropId: estimate.cropId, cropLabel: estimate.cropLabel, nominalKg: estimate.nominalKg, modelId: estimate.modelId, modelLabel: estimate.modelLabel, variant: estimate.variant, markerInFrame: estimate.markerInFrame, markerDescription: estimate.markerDescription, promptVersion: estimate.promptVersion, runs: estimate.runs, successfulRuns: estimate.successfulRuns, fillFactor: estimate.fillFactor, directWeightKg: estimate.directWeightKg, finalWeightKg: estimate.finalWeightKg, confidence: estimate.confidence, imageIssues: estimate.imageIssues, status: estimate.status, reasons: estimate.reasons, actualWeightKg, noGroundTruth: actualWeightKg === null };
    await saveResult(row, photo);
    return res.status(201).json(row);
  } catch (error) {
    console.error('Save result failed:', error.message);
    return res.status(500).json({ error: 'Could not save this result.' });
  }
});

app.delete('/api/results/:id', async (req, res) => {
  try {
    const rows = await readResults();
    const target = rows.find((row) => row.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Result not found.' });
    await deleteResult(target);
    return res.status(204).end();
  } catch (error) {
    console.error('Delete result failed:', error.message);
    return res.status(503).json({ error: 'Saved results storage is unavailable.' });
  }
});

app.get('/api/results.csv', async (_req, res) => {
  let rows;
  try { rows = await readResults(); } catch (error) {
    console.error('Export results failed:', error.message);
    return res.status(503).json({ error: 'Saved results storage is unavailable.' });
  }
  const columns = ['id', 'createdAt', 'cropLabel', 'nominalKg', 'modelLabel', 'variant', 'finalWeightKg', 'directWeightKg', 'actualWeightKg', 'errorKg', 'errorPercent', 'status', 'promptVersion', 'imageHash'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [columns.map(quote).join(',')];
  for (const row of rows) {
    const error = row.actualWeightKg ? row.finalWeightKg - row.actualWeightKg : '';
    const pct = row.actualWeightKg ? (error / row.actualWeightKg) * 100 : '';
    lines.push([row.id, row.createdAt, row.cropLabel, row.nominalKg, row.modelLabel, row.variant, row.finalWeightKg, row.directWeightKg, row.actualWeightKg, error, pct, row.status, row.promptVersion, row.imageHash].map(quote).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sack-weight-results.csv"');
  return res.send(`\uFEFF${lines.join('\r\n')}`);
});

app.get('/api/photos/:name', async (req, res) => {
  if (!/^[\w-]+\.jpg$/.test(req.params.name)) return res.status(400).end();
  try {
    const photo = await readPhoto(req.params.name);
    if (!photo) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(photo);
  } catch (error) {
    console.error('Load photo failed:', error.message);
    return res.status(503).json({ error: 'Saved photo storage is unavailable.' });
  }
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled request error:', error.message);
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

export default app;
