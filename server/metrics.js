export function calculateMetrics(rows) {
  const valid = rows.filter((row) => Number.isFinite(Number(row.actualWeightKg)) && Number(row.actualWeightKg) !== 0);
  if (!valid.length) return { count: 0, mae: null, mape: null, bias: null, within5: null, within10: null };
  const errors = valid.map((row) => Number(row.finalWeightKg) - Number(row.actualWeightKg));
  const absPct = errors.map((error, i) => Math.abs(error / Number(valid[i].actualWeightKg)) * 100);
  return {
    count: valid.length,
    mae: errors.reduce((sum, value) => sum + Math.abs(value), 0) / valid.length,
    mape: absPct.reduce((sum, value) => sum + value, 0) / valid.length,
    bias: errors.reduce((sum, value) => sum + value, 0) / valid.length,
    within5: absPct.filter((value) => value <= 5).length / valid.length,
    within10: absPct.filter((value) => value <= 10).length / valid.length,
  };
}

export function metricSets(rows) {
  const by = (key) => [...new Set(rows.map((row) => row[key]))].map((value) => ({ label: value, metrics: calculateMetrics(rows.filter((row) => row[key] === value)) }));
  return { overall: calculateMetrics(rows), byCrop: by('cropLabel'), byModel: by('modelLabel'), byVariant: by('variant') };
}

export function compareMethods(rows) {
  const grounded = rows.filter((row) => Number.isFinite(Number(row.actualWeightKg)) && Number(row.actualWeightKg) !== 0);
  const method = (predict) => {
    const adapted = grounded.map((row) => ({ ...row, finalWeightKg: predict(row) }));
    return calculateMetrics(adapted);
  };
  return {
    modelDirect: method((row) => row.directWeightKg),
    fillFactor: method((row) => row.finalWeightKg),
    naiveNominal: method((row) => row.nominalKg),
  };
}
