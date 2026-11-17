import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const photosDir = path.join(dataDir, 'photos');
const resultsPath = path.join(dataDir, 'results.json');

function useVercelBlob() {
  return process.env.VERCEL === '1' || Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

async function blobSdk() {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN && process.env.VERCEL === '1') {
    throw new Error('Connect a private Vercel Blob store to this project before using saved tests.');
  }
  return import('@vercel/blob');
}

export async function initializeStorage() {
  if (useVercelBlob()) return;
  await fs.mkdir(photosDir, { recursive: true });
  try { await fs.access(resultsPath); } catch { await fs.writeFile(resultsPath, '[]\n'); }
}

async function readBlobText(pathname) {
  const { get } = await blobSdk();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

export async function readResults() {
  if (!useVercelBlob()) {
    try { return JSON.parse(await fs.readFile(resultsPath, 'utf8')); } catch { return []; }
  }

  const { list } = await blobSdk();
  const blobs = [];
  let cursor;
  let hasMore = true;
  while (hasMore) {
    const page = await list({ prefix: 'results/', limit: 1000, cursor });
    blobs.push(...page.blobs.filter((blob) => blob.pathname.endsWith('.json')));
    cursor = page.cursor;
    hasMore = page.hasMore;
  }

  const rows = [];
  for (let start = 0; start < blobs.length; start += 25) {
    const batch = await Promise.all(blobs.slice(start, start + 25).map(async (blob) => {
      const content = await readBlobText(blob.pathname);
      return content ? JSON.parse(content) : null;
    }));
    rows.push(...batch.filter(Boolean));
  }
  return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveResult(row, photoBuffer) {
  if (!useVercelBlob()) {
    await fs.writeFile(path.join(photosDir, row.photo), photoBuffer);
    const rows = await readResults();
    rows.unshift(row);
    await fs.writeFile(resultsPath, JSON.stringify(rows, null, 2));
    return;
  }

  const { put, del } = await blobSdk();
  const photoPath = `photos/${row.photo}`;
  const resultPath = `results/${row.id}.json`;
  await put(photoPath, photoBuffer, { access: 'private', contentType: 'image/jpeg' });
  try {
    await put(resultPath, JSON.stringify(row), { access: 'private', contentType: 'application/json' });
  } catch (error) {
    await del(photoPath).catch(() => {});
    throw error;
  }
}

export async function deleteResult(row) {
  if (!useVercelBlob()) {
    const rows = await readResults();
    await fs.writeFile(resultsPath, JSON.stringify(rows.filter((item) => item.id !== row.id), null, 2));
    if (row.photo) await fs.rm(path.join(photosDir, row.photo), { force: true });
    return;
  }
  const { del } = await blobSdk();
  await del([`results/${row.id}.json`, `photos/${row.photo}`]);
}

export async function readPhoto(photoName) {
  if (!/^[\w-]+\.jpg$/.test(photoName)) return null;
  if (!useVercelBlob()) {
    try { return await fs.readFile(path.join(photosDir, photoName)); } catch { return null; }
  }
  const { get } = await blobSdk();
  const result = await get(`photos/${photoName}`, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
