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
export async function greekPdfFixture() {
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
  const page = doc.addPage([400, 160]); const fontKey = page.node.newFontDictionary('FixtureGreek', composite);
  page.node.addContentStream(stream(`q\nBT\n${fontKey} 24 Tf\n1 0 0 1 40 90 Tm\n<${chars.map((_, i) => hex(i + 1)).join('')}> Tj\nET\nQ\n`));
  return { bytes: await doc.save({ useObjectStreams: false }), expectedText: text, glyphIds: gids };
}
