import { outputSchema, systemPrompt } from './prompts.js';

const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

function validate(data) {
  const numeric = ['fill_factor', 'estimated_weight_kg', 'range_low_kg', 'range_high_kg', 'confidence'];
  const issues = ['blurry', 'too_dark', 'too_far', 'cut_off', 'glare', 'multiple_sacks', 'no_sack', 'none'];
  if (!data || typeof data !== 'object') throw new Error('Response is not a JSON object');
  for (const key of outputSchema.required) if (!(key in data)) throw new Error(`Missing field: ${key}`);
  if (typeof data.sack_visible !== 'boolean' || typeof data.crop_guess !== 'string' || typeof data.marker_visible !== 'boolean' || typeof data.reasoning !== 'string') throw new Error('Response fields have invalid types');
  if (data.crop_matches_declared !== null && typeof data.crop_matches_declared !== 'boolean') throw new Error('crop_matches_declared must be boolean or null');
  if (!numeric.every((key) => Number.isFinite(data[key]))) throw new Error('Numeric output fields must be finite numbers');
  if (data.fill_factor < 0 || data.fill_factor > 1.3 || data.confidence < 0 || data.confidence > 1) throw new Error('Output values are outside the schema range');
  if (!Array.isArray(data.image_issues) || data.image_issues.some((issue) => !issues.includes(issue))) throw new Error('image_issues contains an invalid value');
  return data;
}

async function callOnce({ apiKey, modelId, prompt, dataUrl }) {
  const started = performance.now();
  let response;
  try { response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:5173', 'X-Title': 'Grain Weight Lab' },
    body: JSON.stringify({
      model: modelId,
      temperature: 0.3,
      max_tokens: 700,
      provider: { require_parameters: true },
      response_format: { type: 'json_schema', json_schema: { name: 'sack_weight_estimate', strict: true, schema: outputSchema } },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
    }),
  }); } catch (error) {
    throw Object.assign(error, { attempt: { ok: false, latencyMs: Math.round(performance.now() - started), usage: null, costUsd: null } });
  }
  const body = await response.json().catch(() => ({}));
  const latencyMs = Math.round(performance.now() - started);
  const fail = (message) => { throw Object.assign(new Error(message), { attempt: { ok: false, latencyMs, usage: body.usage || null, costUsd: body.usage?.cost ?? body.usage?.cost_details?.upstream_inference_cost ?? null } }); };
  if (!response.ok) fail(body?.error?.message || `OpenRouter request failed (${response.status})`);
  const choice = body.choices?.[0];
  if (!choice?.message?.content) fail('OpenRouter returned an empty completion');
  let parsed;
  try { parsed = validate(JSON.parse(choice.message.content)); }
  catch (error) { fail(error.message); }
  const usage = body.usage || null;
  const costUsd = body.usage?.cost ?? body.usage?.cost_details?.upstream_inference_cost ?? null;
  return { ...parsed, usage, costUsd, servedModel: body.model || modelId, latencyMs, attempt: { ok: true, latencyMs, usage, costUsd } };
}

export async function runEstimate(args) {
  let lastError;
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await callOnce(args);
      attempts.push(result.attempt);
      return { ...result, attempts, latencyMs: attempts.reduce((sum, item) => sum + item.latencyMs, 0), costUsd: attempts.reduce((sum, item) => sum + (Number(item.costUsd) || 0), 0) || result.costUsd };
    } catch (error) {
      lastError = error;
      attempts.push(error.attempt || { ok: false, latencyMs: null, usage: null, costUsd: null });
    }
  }
  return { failed: true, error: lastError?.message || 'Model call failed', attempts, latencyMs: attempts.every((item) => Number.isFinite(item.latencyMs)) ? attempts.reduce((sum, item) => sum + item.latencyMs, 0) : null, usage: attempts.map((item) => item.usage).filter(Boolean), costUsd: attempts.reduce((sum, item) => sum + (Number(item.costUsd) || 0), 0) || null };
}
