export const PROMPT_VERSION = 'sack-weight-v1';

export const outputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sack_visible', 'crop_guess', 'crop_matches_declared', 'marker_visible', 'fill_factor', 'estimated_weight_kg', 'range_low_kg', 'range_high_kg', 'confidence', 'image_issues', 'reasoning'],
  properties: {
    sack_visible: { type: 'boolean' },
    crop_guess: { type: 'string' },
    crop_matches_declared: { type: ['boolean', 'null'] },
    marker_visible: { type: 'boolean' },
    fill_factor: { type: 'number', minimum: 0.3, maximum: 1.3 },
    estimated_weight_kg: { type: 'number' },
    range_low_kg: { type: 'number' },
    range_high_kg: { type: 'number' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    image_issues: { type: 'array', items: { type: 'string', enum: ['blurry', 'too_dark', 'too_far', 'cut_off', 'glare', 'multiple_sacks', 'no_sack', 'none'] } },
    reasoning: { type: 'string' },
  },
};

export function buildPrompt({ crop, nominalKg, minKg, maxKg, variant, markerDescription, markerInFrame }) {
  let prompt = `Declared crop: ${crop}. Nominal sack size: ${nominalKg} kg (a completely full standard sack). Typical weight range for this sack: ${minKg} to ${maxKg} kg.\nJudge how full and firm the sack looks compared with a full ${nominalKg} kg sack, using its overall size, bulging versus slack or folded fabric, and how it stands or sits. Report fill_factor (1.0 = exactly nominal) and your direct weight estimate in kg. If the sack is not clearly visible, or there is more than one sack, list that in image_issues and lower confidence. Do not guess beyond what is visible.`;
  if (variant === 'marker') prompt += markerInFrame
    ? `\nA ${markerDescription} has been placed next to the sack as a size reference. Use it to judge the real dimensions of the sack. If the marker is not visible, set marker_visible to false and lower confidence.`
    : `\nThe user indicates that no reference marker is in the frame. Do not assume one is present; set marker_visible to false unless one is clearly visible.`;
  return prompt;
}

export const systemPrompt = 'You estimate the weight of a single sack of grain from a photograph for a warehouse in Tanzania. You are not a scale. Give a careful estimate with an honest uncertainty range, and lower your confidence when the photo is poor. Respond only with JSON that matches the provided schema.';
