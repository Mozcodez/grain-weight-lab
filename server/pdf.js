import { Buffer } from 'node:buffer';

const PAGE_W = 842;
const PAGE_H = 595;
const safe = (value) => String(value ?? '—').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '-');
const pdfText = (value) => safe(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');

function jpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += length + 2;
  }
  return null;
}

function text(commands, x, y, value, size = 8, color = '0.25 0.30 0.25') {
  commands.push(`BT /F1 ${size} Tf ${color} rg 1 0 0 1 ${x} ${y} Tm (${pdfText(value)}) Tj ET`);
}

function line(commands, x1, y1, x2, y2) {
  commands.push(`0.86 0.88 0.84 RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
}

function fitImage(commands, image, x, y, boxW, boxH, name) {
  const size = jpegSize(image);
  if (!size) return;
  const scale = Math.min(boxW / size.width, boxH / size.height);
  const width = size.width * scale;
  const height = size.height * scale;
  commands.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(x + (boxW - width) / 2).toFixed(2)} ${(y + (boxH - height) / 2).toFixed(2)} cm /${name} Do Q`);
}

export function createResultsPdf(rows) {
  const objects = [null];
  const add = (body) => { objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary')); return objects.length - 1; };
  const reserve = () => { objects.push(null); return objects.length - 1; };
  const set = (id, body) => { objects[id] = Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary'); };
  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const pageRows = [];
  for (let i = 0; i < rows.length; i += 6) pageRows.push(rows.slice(i, i + 6));
  if (!pageRows.length) pageRows.push([]);

  pageRows.forEach((group, pageIndex) => {
    const images = [];
    const commands = [];
    text(commands, 32, 560, 'Grain Weight Lab - Saved test results', 16, '0.16 0.25 0.18');
    text(commands, 32, 543, `${rows.length} saved test${rows.length === 1 ? '' : 's'} - page ${pageIndex + 1} of ${pageRows.length}`, 8, '0.45 0.50 0.44');
    const headers = [[32, 'PHOTO'], [122, 'CROP / SIZE'], [225, 'MODEL / VARIANT'], [355, 'FINAL MEAN'], [430, 'DIRECT MEDIAN'], [510, 'ACTUAL'], [575, 'ERROR'], [660, 'STATUS'], [730, 'DATE']];
    headers.forEach(([x, label]) => text(commands, x, 514, label, 7, '0.40 0.46 0.39'));
    line(commands, 32, 505, 810, 505);

    group.forEach((row, index) => {
      const top = 497 - index * 76;
      const bottom = top - 70;
      const image = row._photo;
      if (image && jpegSize(image)) {
        const imageName = `Im${index + 1}`;
        images.push({ name: imageName, buffer: image, size: jpegSize(image) });
        fitImage(commands, image, 34, bottom + 5, 78, 58, imageName);
      } else {
        text(commands, 48, bottom + 34, 'No photo', 8, '0.60 0.62 0.58');
      }
      text(commands, 122, top - 18, row.cropLabel, 8);
      text(commands, 122, top - 31, `${row.nominalKg ?? '-'} kg nominal`, 7, '0.48 0.52 0.47');
      text(commands, 225, top - 18, row.modelLabel, 7);
      text(commands, 225, top - 31, `${row.variant ?? '-'} - ${row.promptVersion ?? '-'}`, 7, '0.48 0.52 0.47');
      text(commands, 355, top - 23, `${Number(row.finalWeightKg).toFixed(1)} kg`, 8);
      text(commands, 430, top - 23, `${Number(row.directWeightKg).toFixed(1)} kg`, 8);
      text(commands, 510, top - 23, row.actualWeightKg ? `${Number(row.actualWeightKg).toFixed(1)} kg` : 'No reading', 7);
      const error = row.actualWeightKg ? Number(row.finalWeightKg) - Number(row.actualWeightKg) : null;
      const pct = error == null ? null : error / Number(row.actualWeightKg) * 100;
      text(commands, 575, top - 19, error == null ? '-' : `${error >= 0 ? '+' : ''}${error.toFixed(1)} kg`, 7);
      text(commands, 575, top - 31, pct == null ? '' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, 7, '0.48 0.52 0.47');
      text(commands, 660, top - 23, row.status, 7);
      text(commands, 730, top - 23, row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : '-', 7);
      line(commands, 32, bottom, 810, bottom);
    });

    const xobjects = [];
    for (const image of images) {
      const imageId = add(Buffer.concat([
        Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.size.width} /Height ${image.size.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>\nstream\n`, 'binary'),
        image.buffer,
        Buffer.from('\nendstream', 'binary'),
      ]));
      xobjects.push(`/${image.name} ${imageId} 0 R`);
    }
    const content = Buffer.from(commands.join('\n'), 'binary');
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'binary'), content, Buffer.from('\nendstream', 'binary')]));
    const resources = `<< /Font << /F1 ${fontId} 0 R >>${xobjects.length ? ` /XObject << ${xobjects.join(' ')} >>` : ''} >>`;
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} /Contents ${contentId} 0 R >>`));
  });

  set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const chunks = [Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'binary')];
  const offsets = [0];
  let length = chunks[0].length;
  objects.slice(1).forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'binary'), body, Buffer.from('\nendobj\n', 'binary')]);
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)];
  chunks.push(Buffer.from(`${xref.join('')}trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, 'binary'));
  return Buffer.concat(chunks);
}
