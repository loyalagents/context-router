import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const requireBackend = createRequire(new URL('../../../../apps/backend/package.json', import.meta.url));
const { PDFDocument, PDFString } = requireBackend('pdf-lib');
export async function standardFontPdfFixture() {
  const doc = await PDFDocument.create();
  doc.addPage([400, 160]).drawText('Synthetic unembedded standard font');
  return Buffer.from(await doc.save());
}
export async function emptyPdfFixture(pages) {
  const doc = await PDFDocument.create();
  for (let page = 0; page < pages; page++) doc.addPage([400, 160]);
  return Buffer.from(await doc.save());
}

// Fixture only: real glyphs from the pinned package's SIL-OFL Liberation font.
// Its LICENSE_LIBERATION stays with the asset; no system-font redistribution.
export async function greekPdfFixture(repetitions = 1) {
  assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 20000);
  const font = await readFile('/private/tmp/context-router-step06-assets/pdfjs-dist-6.3.289/package/standard_fonts/LiberationSans-Regular.ttf');
  assert.equal(createHash('sha256').update(font).digest('hex'), 'f8ace1f892b2bd9dc1792ba7f097fa7588f84fed48321480e04de5390828221f');
  const u16 = (o) => font.readUInt16BE(o); const i16 = (o) => font.readInt16BE(o); const u32 = (o) => font.readUInt32BE(o);
  const tables = new Map();
  for (let i = 0; i < u16(4); i++) {
    const p = 12 + i * 16; const offset = u32(p + 8); const length = u32(p + 12);
    assert.ok(offset + length <= font.length); tables.set(font.toString('ascii', p, p + 4), offset);
  }
  const table = (tag) => { assert.ok(tables.has(tag)); return tables.get(tag); };
  const cmap = table('cmap'); let subtable;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const p = cmap + 4 + i * 8; const candidate = cmap + u32(p + 4);
    if (u16(p) === 3 && u16(p + 2) === 1 && u16(candidate) === 4) subtable = candidate;
  }
  assert.ok(subtable !== undefined);
  const segments = u16(subtable + 6) / 2; const ends = subtable + 14;
  const starts = ends + segments * 2 + 2; const deltas = starts + segments * 2; const offsets = deltas + segments * 2;
  const numGlyphs = u16(table('maxp') + 4);
  const glyphFor = (cp) => {
    for (let i = 0; i < segments; i++) {
      const first = u16(starts + i * 2); if (cp < first || cp > u16(ends + i * 2)) continue;
      const delta = i16(deltas + i * 2); const address = offsets + i * 2; const offset = u16(address);
      let gid;
      if (!offset) gid = (cp + delta) & 0xffff;
      else { const p = address + offset + 2 * (cp - first); assert.ok(p + 2 <= subtable + u16(subtable + 2)); gid = u16(p); if (gid) gid = (gid + delta) & 0xffff; }
      assert.ok(gid > 0 && gid < numGlyphs); return gid;
    }
    throw new Error('Fixture character absent from font');
  };
  const text = 'Αθήνα'; const chars = [...text]; const gids = chars.map((ch) => glyphFor(ch.codePointAt(0)));
  assert.deepEqual(gids, [351, 389, 379, 394, 382]);
  const head = table('head'); const hhea = table('hhea'); const scale = 1000 / u16(head + 18);
  const advance = (gid) => u16(table('hmtx') + Math.min(gid, u16(hhea + 34) - 1) * 4) * scale;
  const cidToGid = Buffer.alloc((chars.length + 1) * 2); gids.forEach((gid, i) => cidToGid.writeUInt16BE(gid, (i + 1) * 2));
  const hex = (v) => v.toString(16).padStart(4, '0');
  const mappings = chars.map((ch, i) => `<${hex(i + 1)}> <${hex(ch.codePointAt(0))}>`).join('\n');
  const toUnicode = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /FixtureGreekUCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${chars.length} beginbfchar\n${mappings}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  const doc = await PDFDocument.create(); const ctx = doc.context;
  const stream = (bytes, attrs = {}) => ctx.register(ctx.flateStream(bytes, attrs)); const dict = (value) => ctx.register(ctx.obj(value));
  const descriptor = dict({ Type: 'FontDescriptor', FontName: 'LiberationSans', Flags: 4,
    FontBBox: [36, 38, 40, 42].map((o) => i16(head + o) * scale), ItalicAngle: font.readInt32BE(table('post') + 4) / 65536,
    Ascent: i16(hhea + 4) * scale, Descent: i16(hhea + 6) * scale, CapHeight: i16(table('OS/2') + 88) * scale,
    StemV: 80, FontFile2: stream(font, { Length1: font.length }) });
  const descendant = dict({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'LiberationSans',
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: descriptor, CIDToGIDMap: stream(cidToGid), DW: advance(0), W: [1, gids.map(advance)] });
  const composite = dict({ Type: 'Font', Subtype: 'Type0', BaseFont: 'LiberationSans', Encoding: 'Identity-H', DescendantFonts: [descendant], ToUnicode: stream(toUnicode) });
  const word = chars.map((_, i) => hex(i + 1)).join('');
  for (let remaining = repetitions; remaining > 0;) {
    const count = Math.min(remaining, 2250); remaining -= count;
    const page = doc.addPage(repetitions === 1 ? [400, 160] : [1000, 1000]);
    const fontKey = page.node.newFontDictionary('FixtureGreek', composite);
    const rows = [];
    for (let used = 0, row = 0; used < count; row++) {
      const words = Math.min(30, count - used); used += words;
      rows.push(`BT\n${fontKey} ${repetitions === 1 ? 24 : 12} Tf\n1 0 0 1 20 ${repetitions === 1 ? 90 : 980 - row * 13} Tm\n<${word.repeat(words)}> Tj\nET`);
    }
    page.node.addContentStream(stream(`q\n${rows.join('\n')}\nQ\n`));
  }
  return { bytes: await doc.save({ useObjectStreams: false }), expectedText: text.repeat(repetitions), glyphIds: gids };
}

export async function imageOnlyPdfFixture() {
  const doc = await PDFDocument.create(); const ctx = doc.context; const page = doc.addPage([100, 100]);
  const image = ctx.register(ctx.stream(Buffer.from([255, 0, 0]), { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1,
    ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  const name = page.node.newXObject('FixtureImage', image);
  page.node.addContentStream(ctx.register(ctx.flateStream(`q\n80 0 0 80 10 10 cm\n${name} Do\nQ\n`)));
  return Buffer.from(await doc.save());
}

// Synthetic legacy Standard Security R2 fixture only; never product cryptography.
// Correct-password decryption and wrong-password rejection are independently checked in PDF.js.
export function encryptedPdfFixture(password = '') {
  const padding = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
  const padded = (value) => Buffer.concat([Buffer.from(value, 'ascii'), padding]).subarray(0, 32);
  const md5 = (value) => createHash('md5').update(value).digest();
  const rc4 = (key, input) => {
    const state = Uint8Array.from({ length: 256 }, (_, i) => i); let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + state[i] + key[i % key.length]) & 255; [state[i], state[j]] = [state[j], state[i]]; }
    const output = Buffer.alloc(input.length); let i = 0; j = 0;
    for (let k = 0; k < input.length; k++) {
      i = (i + 1) & 255; j = (j + state[i]) & 255; [state[i], state[j]] = [state[j], state[i]];
      output[k] = input[k] ^ state[(state[i] + state[j]) & 255];
    }
    return output;
  };
  const owner = rc4(md5(padded('fixture-distinct-owner')).subarray(0, 5), padded(password));
  const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const id = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const key = md5(Buffer.concat([padded(password), owner, permissions, id])).subarray(0, 5);
  const user = rc4(key, padding);
  const objectKey = md5(Buffer.concat([key, Buffer.from([4, 0, 0, 0, 0])])).subarray(0, 10);
  const content = rc4(objectKey, Buffer.from('BT /F1 12 Tf 10 10 Td (Encrypted fixture) Tj ET', 'ascii'));
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')]; const offsets = []; let length = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(length); const bytes = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    parts.push(bytes); length += bytes.length;
  });
  parts.push(Buffer.from(`xref\n0 7\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R /Encrypt 5 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}
