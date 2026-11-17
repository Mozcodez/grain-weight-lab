import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function Icon({ name, size = 18 }) {
  const paths = {
    leaf: <><path d="M20 4c-8 0-14 4-14 11a5 5 0 0 0 5 5c7 0 11-6 9-16Z"/><path d="M4 21c3-6 7-9 13-12"/></>,
    camera: <><path d="M14 4h-4L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4l-2-3Z"/><circle cx="12" cy="13" r="3.5"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 5-6"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6"/><path d="M10 11v6m4-6v6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const number = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const money = (value) => Number.isFinite(Number(value)) ? `$${Number(value).toFixed(5)}` : '—';

async function prepareImage(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  const buffer = await blob.arrayBuffer();
  const hashBytes = await crypto.subtle.digest('SHA-256', buffer);
  const hash = [...new Uint8Array(hashBytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
  return { dataUrl, hash, size: blob.size, width: canvas.width, height: canvas.height };
}

function Field({ label, children, hint }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function App() {
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('estimate');
  const [cropId, setCropId] = useState('maize');
  const [nominalKg, setNominalKg] = useState(50);
  const [modelId, setModelId] = useState('google/gemini-3.8-flash');
  const [variant, setVariant] = useState('marker');
  const [runs, setRuns] = useState(3);
  const [markerInFrame, setMarkerInFrame] = useState(true);
  const [markerDescription, setMarkerDescription] = useState('A4 sheet, 21 x 29.7 cm');
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [actualWeightKg, setActualWeightKg] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [results, setResults] = useState({ rows: [], metrics: {}, comparisons: {} });

  const selectedCrop = config?.crops.find((crop) => crop.id === cropId);
  const selectedModel = config?.models.find((model) => model.id === modelId);
  const options = selectedCrop?.nominal_kg_options || [50, 100];
  async function loadConfig() {
    try { const response = await fetch('/api/config'); if (!response.ok) throw new Error('Could not load app settings.'); setConfig(await response.json()); }
    catch (error) { setNotice({ type: 'error', text: `${error.message} Start the app with npm run dev.` }); }
  }
  async function loadResults() {
    try { const response = await fetch('/api/results'); setResults(await response.json()); }
    catch { setNotice({ type: 'error', text: 'Saved results could not be loaded.' }); }
  }
  useEffect(() => { loadConfig(); loadResults(); }, []);
  useEffect(() => { if (!options.includes(Number(nominalKg))) setNominalKg(options[0]); }, [cropId, config]);
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  async function acceptFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setNotice({ type: 'error', text: 'Choose an image file.' }); return; }
    try {
      const prepared = await prepareImage(file);
      setPhoto({ ...prepared, mimeType: 'image/jpeg', name: file.name });
      setPreview(prepared.dataUrl);
      setEstimate(null); setNotice(null); setActualWeightKg('');
    } catch { setNotice({ type: 'error', text: 'This image could not be opened. Try another photo.' }); }
  }

  async function runEstimate() {
    if (!photo) { setNotice({ type: 'error', text: 'Add a photo of one sack to begin.' }); return; }
    if (photo.size > 5 * 1024 * 1024) { setNotice({ type: 'error', text: 'The resized photo is larger than 5 MB. Try a smaller image.' }); return; }
    setBusy(true); setNotice(null); setEstimate(null);
    try {
      const response = await fetch('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: photo.dataUrl, mimeType: photo.mimeType, imageHash: photo.hash, cropId, nominalKg: Number(nominalKg), modelId, variant, runs: Number(runs), markerInFrame, markerDescription }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The estimate could not be completed.');
      setEstimate(data);
    } catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(false); }
  }

  async function saveResult() {
    if (!estimate || !photo) return;
    setBusy(true); setNotice(null);
    try {
      const response = await fetch('/api/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimate, imageBase64: photo.dataUrl, actualWeightKg }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the test.');
      setNotice({ type: 'success', text: actualWeightKg ? 'Saved to the test log with ground truth.' : 'Saved to the test log without ground truth.' });
      await loadResults();
    } catch (error) { setNotice({ type: 'error', text: error.message }); }
    finally { setBusy(false); }
  }

  async function deleteRow(id) {
    try { const response = await fetch(`/api/results/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error(); await loadResults(); }
    catch { setNotice({ type: 'error', text: 'Could not delete this result.' }); }
  }

  function pickFile(event) { acceptFile(event.target.files?.[0]); event.target.value = ''; }
  const setTabTo = (value) => { setTab(value); if (value === 'results') loadResults(); };

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#top" className="brand"><span className="brand-mark"><Icon name="leaf" size={22}/></span><span>grain<span className="brand-light">lab</span><small>WEIGHT STUDY</small></span></a>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Workspace">
        <button className={tab === 'estimate' ? 'nav-item active' : 'nav-item'} aria-label="Estimate" aria-current={tab === 'estimate' ? 'page' : undefined} onClick={() => setTabTo('estimate')}><Icon name="camera"/><span>Estimate</span><span className="nav-dot"/></button>
        <button className={tab === 'results' ? 'nav-item active' : 'nav-item'} aria-label={`Test results, ${results.rows.length} saved`} aria-current={tab === 'results' ? 'page' : undefined} onClick={() => setTabTo('results')}><Icon name="chart"/><span>Test results</span><span className="nav-count">{results.rows.length}</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="status-dot"/><div><strong>Prototype mode</strong><span>Local test environment</span></div></div>
    </aside>

    <main className="main-content" id="top">
      <header className="topbar"><div className="crumb">SMART GRAIN WAREHOUSE <span>/</span> {tab === 'estimate' ? 'WEIGHT ESTIMATION' : 'TEST LOG'}</div><div className="topbar-right"><span className="region-pill"><span className="online-dot"/>Tanzania · EAT</span><div className="avatar">WL</div></div></header>
      {notice && <div className={`notice ${notice.type}`} role="status"><Icon name={notice.type === 'success' ? 'check' : 'info'} size={17}/><span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><Icon name="close" size={16}/></button></div>}

      {tab === 'estimate' ? <>
        <div className="page-heading"><div><div className="eyebrow">FIELD STUDY · PROTOTYPE 01</div><h1>Estimate sack weight</h1><p>Evaluate how well vision models read a grain sack from a single photo.</p></div><div className="session-tag"><span className="pulse-dot"/>LIVE TEST SESSION</div></div>
        <div className="layout-grid">
          <section className="form-column">
            <div className="panel config-panel">
              <div className="panel-heading"><div><span className="step-num">01</span><div><h2>Test configuration</h2><p>Set the conditions for this estimate.</p></div></div><span className="quiet-tag">REQUIRED</span></div>
              {!config ? <div className="loading-line">Loading configuration…</div> : <div className="field-grid">
                <Field label="CROP TYPE"><select value={cropId} onChange={(e) => setCropId(e.target.value)}>{config.crops.map((crop) => <option key={crop.id} value={crop.id}>{crop.label}</option>)}</select></Field>
                <Field label="NOMINAL SACK SIZE"><select value={nominalKg} onChange={(e) => setNominalKg(Number(e.target.value))}>{options.map((value) => <option key={value} value={value}>{value} kg</option>)}</select></Field>
                <Field label="VISION MODEL"><select value={modelId} onChange={(e) => setModelId(e.target.value)}>{config.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><span className="field-hint">{selectedModel?.price}</span></Field>
                <Field label="PROMPT VARIANT"><select value={variant} onChange={(e) => setVariant(e.target.value)}><option value="plain">Plain · Visual cues only</option><option value="marker">Marker · Size reference</option></select></Field>
                <Field label="INDEPENDENT RUNS"><select value={runs} onChange={(e) => setRuns(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} {value === 1 ? 'run' : 'runs'}</option>)}</select></Field>
              </div>}
              {variant === 'marker' && <div className="marker-box"><label className="checkbox-row"><input type="checkbox" checked={markerInFrame} onChange={(e) => setMarkerInFrame(e.target.checked)}/><span className="check-custom"><Icon name="check" size={13}/></span><span>Reference marker included in photo</span></label><Field label="MARKER DESCRIPTION"><input value={markerDescription} onChange={(e) => setMarkerDescription(e.target.value)} placeholder="e.g. A4 sheet, 21 x 29.7 cm"/></Field></div>}
              <div className="range-note"><Icon name="info" size={15}/><span>Reference range: <strong>{(nominalKg * (config?.plausible_range.min_factor ?? 0)).toFixed(0)}–{(nominalKg * (config?.plausible_range.max_factor || 1.1)).toFixed(0)} kg</strong> · Crop density estimates are placeholders pending local validation.</span></div>
            </div>

            <div className="panel photo-panel">
              <div className="panel-heading"><div><span className="step-num">02</span><div><h2>Capture or upload</h2><p>Frame one sack clearly, including the full base and top.</p></div></div><span className="photo-count"><Icon name="camera" size={15}/> 1 PHOTO</span></div>
              <input id="photo-file" className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={pickFile}/>
              {preview ? <div className="photo-preview" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); acceptFile(e.dataTransfer.files?.[0]); }}><img src={preview} alt="Selected sack photo"/><div className="preview-overlay"><span>{photo?.width} × {photo?.height} px · {(photo?.size / 1024).toFixed(0)} KB</span><button className="subtle-button" onClick={() => document.getElementById('photo-file').click()}>Replace photo</button></div><button className="remove-photo" aria-label="Remove photo" onClick={() => { setPhoto(null); setPreview(''); setEstimate(null); }}><Icon name="close"/></button></div> : <label htmlFor="photo-file" role="button" tabIndex="0" aria-label="Choose or drop a photo of one grain sack" className={`drop-zone ${isDragging ? 'dragging' : ''}`} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('photo-file').click(); } }} onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={(e) => { e.preventDefault(); setIsDragging(false); acceptFile(e.dataTransfer.files?.[0]); }}><span className="upload-mark"><Icon name="upload" size={21}/></span><strong>Drop your sack photo here</strong><span>or <u>browse files</u> from your device</span><small>JPG, PNG or WEBP · resized to max 1280 px</small></label>}
              <div className="photo-guidance"><span><i className="guidance-check"><Icon name="check" size={11}/></i>Full sack in frame</span><span><i className="guidance-check"><Icon name="check" size={11}/></i>Plain background</span><span><i className="guidance-check"><Icon name="check" size={11}/></i>Good lighting</span></div>
            </div>
            <div className="estimate-action"><div className="cost-hint"><span>MODEL RATE · PER 1M TOKENS</span><strong>{selectedModel?.price.split(' per million')[0] || '—'}</strong></div><button className="primary-button" onClick={runEstimate} disabled={busy || !config}>{busy && !estimate ? <span className="spinner"/> : <Icon name="leaf" size={18}/>} {busy && !estimate ? 'Estimating…' : 'Estimate weight'}<Icon name="arrow" size={17}/></button></div>
          </section>

          <section className="result-column" aria-live="polite">
            {!estimate ? <div className="empty-result panel"><div className="illustration"><div className="illustration-circle"><Icon name="leaf" size={34}/></div><span className="orbit orbit-one"/><span className="orbit orbit-two"/></div><span className="empty-kicker">READY WHEN YOU ARE</span><h2>Your estimate will appear here</h2><p>Configure the test, add a clear photo of one sack, then run the model.</p><div className="empty-rule"/><div className="empty-stat"><span>TEST METHOD</span><strong>{variant === 'marker' ? 'Marker-assisted vision' : 'Visual fullness estimate'}</strong></div><div className="empty-stat"><span>AGGREGATION</span><strong>Mean direct weight across {runs} independent {runs === 1 ? 'run' : 'runs'}</strong></div><div className="secure-note"><span className="secure-icon">⌁</span>Photo stays in your local test log when saved</div></div> : <EstimateResult estimate={estimate} onSave={saveResult} busy={busy} actualWeightKg={actualWeightKg} setActualWeightKg={setActualWeightKg} />}
          </section>
        </div>
        <div className="footer-note"><span>GRAIN WEIGHT LAB</span><span>Estimates are exploratory and are not a substitute for a calibrated scale.</span></div>
      </> : <ResultsPage results={results} onDelete={deleteRow} onRefresh={loadResults}/>}
    </main>
  </div>;
}

function EstimateResult({ estimate, onSave, busy, actualWeightKg, setActualWeightKg }) {
  const totalCost = estimate.runs.filter((run) => !run.failed).reduce((sum, run) => sum + (Number(run.costUsd) || 0), 0);
  const confidence = Math.round(estimate.confidence * 100);
  const delta = ((estimate.directWeightKg - estimate.finalWeightKg) / estimate.finalWeightKg) * 100;
  return <div className="result-stack">
    {estimate.duplicate && <div className="duplicate-banner"><Icon name="info" size={17}/><span>This exact resized image was logged before. It will still be estimated, but watch for duplicate measurements.</span></div>}
    <div className="panel hero-result"><div className="result-topline"><span className="eyebrow">WEIGHT ESTIMATE · MEAN OF RUNS</span><span className={`status-badge ${estimate.status === 'Accepted' ? 'accepted' : 'review'}`}><i/>{estimate.status}</span></div><div className="weight-line"><strong>{number(estimate.finalWeightKg)}</strong><span>kg</span></div><div className="weight-caption">AVERAGE DIRECT MODEL WEIGHT <span>· {estimate.cropLabel} / {estimate.nominalKg} kg sack</span></div><div className="result-metrics"><div><span>MEDIAN DIRECT</span><strong>{number(estimate.directWeightKg)} <small>kg</small></strong></div><div><span>MEDIAN VS MEAN</span><strong className={Math.abs(delta) > 15 ? 'text-warning' : ''}>{delta >= 0 ? '+' : ''}{number(delta)}<small>%</small></strong></div><div><span>MEAN CONFIDENCE</span><strong>{confidence}<small>%</small></strong></div></div></div>
    {estimate.reasons.length > 0 && <div className="review-reasons"><strong><Icon name="info" size={16}/> Review recommended</strong><ul>{estimate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
    <div className="panel run-panel"><div className="run-heading"><div><span className="eyebrow">MODEL OUTPUTS</span><h3>Individual runs</h3></div><span className="run-count">{estimate.successfulRuns} / {estimate.runs.length} SUCCEEDED</span></div><div className="run-table-wrap"><table className="run-table"><thead><tr><th>RUN</th><th>FILL</th><th>DIRECT KG</th><th>RANGE KG</th><th>CONF.</th><th>LATENCY</th><th>COST</th></tr></thead><tbody>{estimate.runs.map((run, index) => run.failed ? <tr key={index} className="failed-run"><td>0{index + 1}</td><td colSpan="6">Failed · {run.error}</td></tr> : <tr key={index}><td>0{index + 1}</td><td>{number(run.fill_factor, 2)}</td><td>{number(run.estimated_weight_kg)}</td><td>{number(run.range_low_kg)}–{number(run.range_high_kg)}</td><td><span className="confidence-pill">{Math.round(run.confidence * 100)}%</span></td><td>{run.latencyMs ? `${(run.latencyMs / 1000).toFixed(1)}s` : '—'}</td><td>{money(run.costUsd)}</td></tr>)}</tbody></table></div>
      <div className="run-reasoning">{estimate.runs.filter((run) => !run.failed).map((run, index) => <div key={index}><span>RUN 0{index + 1} REASONING</span><p>{run.reasoning}</p>{run.image_issues.some((issue) => issue !== 'none') && <small>Image issues: {run.image_issues.filter((issue) => issue !== 'none').join(', ')}</small>}</div>)}</div><div className="model-foot"><span>{estimate.modelLabel}</span><span>Total reported cost: {money(totalCost)}</span><span>Prompt {estimate.promptVersion}</span></div></div>
    <div className="panel save-panel"><div><span className="eyebrow">GROUND TRUTH</span><h3>Add to test log</h3><p>Enter a scale reading if available. You can also save this run without it.</p></div><div className="save-controls"><Field label="ACTUAL WEIGHT (KG)"><input inputMode="decimal" type="number" min="0.1" step="0.1" value={actualWeightKg} onChange={(e) => setActualWeightKg(e.target.value)} placeholder="Optional"/></Field><button className="secondary-button" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save to test log'}<Icon name="arrow" size={16}/></button></div></div>
  </div>;
}

function MetricCard({ title, value, unit = '', note }) { return <div className="metric-card"><span>{title}</span><strong>{value == null ? '—' : `${number(value, title.includes('%') ? 1 : 2)}${unit}`}</strong>{note && <small>{note}</small>}</div>; }

function MetricSection({ title, metrics }) {
  return <div className="metric-section"><h3>{title}<span>{metrics?.count || 0} GROUNDED TESTS</span></h3><div className="metric-grid"><MetricCard title="MAE" value={metrics?.mae} unit=" kg"/><MetricCard title="MAPE" value={metrics?.mape} unit="%"/><MetricCard title="BIAS" value={metrics?.bias} unit=" kg" note="+ over / − under"/><MetricCard title="WITHIN ±5%" value={metrics?.within5 == null ? null : metrics.within5 * 100} unit="%"/><MetricCard title="WITHIN ±10%" value={metrics?.within10 == null ? null : metrics.within10 * 100} unit="%"/></div></div>;
}

function ResultsPage({ results, onDelete, onRefresh }) {
  const { rows, metrics, comparisons } = results;
  return <>
    <div className="page-heading results-heading"><div><div className="eyebrow">FIELD STUDY · TEST LOG</div><h1>Results & accuracy</h1><p>Compare model estimates with scale readings to evaluate real-world performance.</p></div><a className="secondary-button export-button" href="/api/results.csv"><Icon name="upload" size={16}/>Export CSV</a></div>
    <div className="summary-strip"><div><span>ALL SAVED TESTS</span><strong>{rows.length}</strong></div><div><span>WITH GROUND TRUTH</span><strong>{metrics?.overall?.count || 0}</strong></div><div><span>BEST BASELINE CHECK</span><strong>{comparisons?.naiveNominal?.mae == null ? 'Awaiting scale readings' : `Nominal MAE ${number(comparisons.naiveNominal.mae)} kg`}</strong></div><button className="refresh-button" onClick={onRefresh}>Refresh data ↻</button></div>
    <div className="panel comparison-panel"><div className="section-title"><div><span className="eyebrow">DOES THE MODEL ADD VALUE?</span><h2>Prediction methods vs naive baseline</h2></div><span className="ground-truth-chip">GROUND TRUTH ONLY</span></div><div className="comparison-grid">{[['Direct estimate', comparisons?.modelDirect], ['Fill factor', comparisons?.fillFactor], ['Naive · nominal weight', comparisons?.naiveNominal]].map(([label, item], index) => <div className={`comparison-item ${index === 2 ? 'baseline' : ''}`} key={label}><span>{label}</span><div><small>MAE</small><strong>{item?.mae == null ? '—' : `${number(item.mae)} kg`}</strong></div><div><small>MAPE</small><strong>{item?.mape == null ? '—' : `${number(item.mape)}%`}</strong></div><p>{index === 2 ? 'Always predicts the declared sack size.' : 'Median absolute percentage error against the scale.'}</p></div>)}</div></div>
    <div className="panel metrics-panel"><div className="section-title"><div><span className="eyebrow">ACCURACY BREAKDOWN</span><h2>Measured performance</h2></div></div><MetricSection title="Overall" metrics={metrics?.overall}/><div className="group-metrics">{[['By crop', metrics?.byCrop], ['By model', metrics?.byModel], ['By prompt variant', metrics?.byVariant]].map(([group, items]) => <div key={group} className="group-block"><h3>{group}</h3>{(!items?.length || items.every((item) => item.metrics.count === 0)) ? <p className="empty-group">Add actual weights to unlock this breakdown.</p> : items.map((item) => <div className="group-row" key={item.label}><strong>{item.label}</strong><span>n={item.metrics.count}</span><b>MAE {number(item.metrics.mae)} kg</b><b>MAPE {number(item.metrics.mape)}%</b></div>)}</div>)}</div></div>
    <div className="panel saved-tests"><div className="section-title"><div><span className="eyebrow">RECENT MEASUREMENTS</span><h2>Saved tests <span className="count-pill">{rows.length}</span></h2></div><span className="quiet-tag">LOCAL JSON LOG</span></div>{rows.length === 0 ? <div className="no-tests"><span className="empty-icon"><Icon name="chart" size={22}/></span><h3>No saved tests yet</h3><p>Run an estimate and save it here to start comparing against scale readings.</p></div> : <div className="saved-table-wrap"><table className="saved-table"><thead><tr><th>PHOTO</th><th>CROP / SIZE</th><th>MODEL / VARIANT</th><th>FINAL MEAN</th><th>DIRECT MEDIAN</th><th>ACTUAL</th><th>ERROR</th><th>STATUS</th><th/></tr></thead><tbody>{rows.map((row) => { const error = row.actualWeightKg ? Number(row.finalWeightKg) - Number(row.actualWeightKg) : null; const pct = row.actualWeightKg ? error / Number(row.actualWeightKg) * 100 : null; return <tr key={row.id}><td><img className="thumbnail" src={`/api/photos/${row.photo}`} alt={`${row.cropLabel} sack test`}/></td><td><strong>{row.cropLabel}</strong><small>{row.nominalKg} kg nominal</small></td><td><strong>{row.modelLabel}</strong><small>{row.variant} · {row.promptVersion}</small></td><td>{number(row.finalWeightKg)} kg</td><td>{number(row.directWeightKg)} kg</td><td>{row.actualWeightKg ? `${number(row.actualWeightKg)} kg` : <span className="no-ground">No ground truth</span>}</td><td>{pct == null ? '—' : <><strong className={Math.abs(pct) > 10 ? 'text-warning' : ''}>{error >= 0 ? '+' : ''}{number(error)} kg</strong><small>{pct >= 0 ? '+' : ''}{number(pct)}%</small></>}</td><td><span className={`status-badge compact ${row.status === 'Accepted' ? 'accepted' : 'review'}`}><i/>{row.status}</span></td><td><button className="icon-button delete-button" aria-label={`Delete ${row.cropLabel} test`} onClick={() => onDelete(row.id)}><Icon name="trash" size={16}/></button></td></tr>; })}</tbody></table></div>}</div>
    <div className="footer-note"><span>GRAIN WEIGHT LAB</span><span>Results saved locally on this device.</span></div>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
