import { promises as fs } from 'fs';
import { CVSections, StyleHints } from '../routes/cv';

export interface ParsedFile {
  text: string;
  /** Undefined for TXT and OCR'd image/PDF sources — no style data exists to extract there. */
  styleHints?: StyleHints;
}

/**
 * Parse a file (PDF, DOCX, PPTX, TXT, PNG/JPEG) and return its raw text content plus any
 * style hints recoverable from the source's own formatting.
 */
export async function parseFile(filePath: string, mimetype: string): Promise<ParsedFile> {
  switch (mimetype) {
    case 'application/pdf':
      return _parsePDF(filePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return _parseDOCX(filePath);
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return _parsePPTX(filePath);
    case 'text/plain':
      return { text: await _parseTXT(filePath) };
    case 'image/png':
    case 'image/jpeg':
      return { text: await _ocrImage(filePath) };
    default:
      throw new Error(`Unsupported MIME type: ${mimetype}`);
  }
}

// Below this many extracted chars we treat the PDF as having no real text layer
// (scanned/image-only or text-as-outlines) and fall back to OCR.
const OCR_TEXT_THRESHOLD = 50;

async function _parsePDF(filePath: string): Promise<ParsedFile> {
  // Prefer pdfjs-dist: it preserves visual reading order (so the candidate's name
  // lands on its own line) and is far more robust than pdf-parse on real-world PDFs.
  let result: ParsedFile = { text: '' };
  try {
    result = await _parsePdfWithPdfjs(filePath);
  } catch {
    // Fallback to pdf-parse if pdfjs can't open the document.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    result = { text: parsed.text };
  }

  // Image-only / outlined PDFs yield (almost) no extractable text. Last resort: OCR.
  if (result.text.trim().length < OCR_TEXT_THRESHOLD) {
    try {
      const ocrText = await _ocrPdf(filePath);
      // OCR recovers text only — no font/color info exists to carry as a style hint.
      if (ocrText.trim().length > result.text.trim().length) return { text: ocrText };
    } catch (err) {
      // OCR failed (e.g. lang data unreachable, render error) — fall through with what
      // we have; the route then rejects with the "too little text" message.
      console.error('[parser] OCR fallback failed:', (err as Error).message);
    }
  }

  return result;
}

/**
 * OCR a set of images (Buffers or file paths) with tesseract.js, concatenating recognized text
 * page by page. Shared by the scanned-PDF fallback and standalone image uploads.
 */
async function _ocrWithTesseract(images: Array<string | Buffer>): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const texts: string[] = [];
    for (const image of images) {
      const { data } = await worker.recognize(image);
      if (data.text) texts.push(data.text);
    }
    return texts.join('\n\n');
  } finally {
    await worker.terminate();
  }
}

/**
 * OCR fallback for PDFs with no text layer: render each page to a PNG via pdf-to-img
 * then recognize text with tesseract.js. Slow (seconds/page) — only used when the
 * normal text extractors come back near-empty.
 */
async function _ocrPdf(filePath: string): Promise<string> {
  const { pdf } = await import('pdf-to-img');

  // scale=3 ≈ 216 DPI — enough resolution for tesseract to read CV body text.
  const document = await pdf(filePath, { scale: 3 });

  const images: Buffer[] = [];
  // Iterate by index (length/getPage) rather than `for await` — the latter needs
  // the ES2023 AsyncIterable lib types which this tsconfig target predates.
  for (let p = 1; p <= document.length; p++) {
    images.push(await document.getPage(p));
  }
  return _ocrWithTesseract(images);
}

/** OCR a standalone uploaded image (JPEG/PNG). No style data is recoverable from a photo/scan. */
async function _ocrImage(filePath: string): Promise<string> {
  return _ocrWithTesseract([filePath]);
}

/** Most-frequent key in a char-weighted tally — used to pick a document's dominant font. */
function _mostCommon(counts: Map<string, number>): string | undefined {
  let best: string | undefined;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) { max = v; best = k; }
  }
  return best;
}

/**
 * Extract text from a PDF using pdfjs-dist, reconstructing visual lines by grouping
 * text items on the same vertical band and ordering them top-to-bottom, left-to-right.
 * Also does a best-effort style pass: pdfjs doesn't expose a real bold flag or per-run color
 * via getTextContent(), only whatever family name it resolves for the embedded font — so this
 * only recovers a dominant body font (bolded lines are guessed from "Bold"/"Black"/"Heavy" in
 * that resolved name) rather than true per-run styling.
 */
async function _parsePdfWithPdfjs(filePath: string): Promise<ParsedFile> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(filePath));
  // pdfjs detaches/transfers `data`'s underlying buffer once handed to getDocument (it comes
  // back zero-length) — extract the literal font names from it first, before that happens.
  const literalFonts = _pickPdfHeadingBodyFonts(_extractPdfBaseFontNames(data));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pageTexts: string[] = [];
  const fontCharCounts = new Map<string, number>();

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const styles = (content.styles || {}) as Record<string, { fontFamily?: string } | undefined>;
    const items = (content.items as Array<{ str: string; transform: number[]; fontName?: string }>).filter(
      (it) => typeof it.str === 'string'
    );

    // Group items into lines keyed by rounded Y (PDF origin is bottom-left, so larger Y = higher).
    const lineMap = new Map<number, Array<{ x: number; str: string; font?: string }>>();
    for (const it of items) {
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);
      // Snap near-equal Y values together (±2pt) to the same line bucket.
      let key = y;
      for (const existing of lineMap.keys()) {
        if (Math.abs(existing - y) <= 2) { key = existing; break; }
      }
      if (!lineMap.has(key)) lineMap.set(key, []);
      const font = it.fontName ? styles[it.fontName]?.fontFamily : undefined;
      if (font && it.str.trim()) {
        fontCharCounts.set(font, (fontCharCounts.get(font) || 0) + it.str.length);
      }
      lineMap.get(key)!.push({ x, str: it.str, font });
    }

    const lines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0]) // top to bottom
      .map(([, parts]) => {
        const sorted = parts.sort((a, b) => a.x - b.x);
        const text = sorted
          .map((pt) => pt.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) return '';
        const dominant = _dominantPdfFont(sorted);
        // Whole-line bold guess, wrapped as the same markdown emphasis convention the
        // exporter/editor already round-trip for links (see injectLinkAnchors below).
        return dominant && /bold|black|heavy/i.test(dominant) ? `**${text}**` : text;
      })
      .filter(Boolean);

    pageTexts.push(lines.join('\n'));
  }

  await doc.destroy();

  // `literalFonts` (extracted above, before pdfjs consumed `data`) recovers real font names
  // directly from the PDF's own font dictionaries — pdfjs's public API only ever exposes a
  // generic CSS bucket ("sans-serif"/"serif"/"monospace") for embedded fonts, never the
  // literal name, so it can't tell a body font from a distinct heading/display font when both
  // resolve to the same bucket (e.g. two different sans fonts).
  //
  // Fall back to the generic bucket name when the literal-name pass found nothing (e.g. the
  // PDF's font dictionaries sit inside compressed object streams the regex can't see into) —
  // still better than no hint at all, since `_htmlFontFor`/`fontChoiceFor`'s bucketing
  // matches on exactly those generic keywords (with a `sans` guard so "sans-serif" doesn't
  // false-match the serif branch).
  const bodyFont = literalFonts.bodyFont || _mostCommon(fontCharCounts);
  const styleHints: StyleHints | undefined = bodyFont
    ? { bodyFont, headingFont: literalFonts.headingFont }
    : undefined;

  return { text: pageTexts.join('\n\n'), styleHints };
}

function _dominantPdfFont(parts: Array<{ str: string; font?: string }>): string | undefined {
  const counts = new Map<string, number>();
  for (const p of parts) {
    if (!p.font) continue;
    counts.set(p.font, (counts.get(p.font) || 0) + p.str.length);
  }
  return _mostCommon(counts);
}

/**
 * Recover literal embedded-font names directly from the PDF's own font dictionaries
 * (`/BaseFont /ABCDEF+Family-Weight`), stripping the random 6-letter subset prefix PDF
 * generators add. Only finds fonts declared outside compressed object streams (most PDFs
 * from Office/browser "Print to PDF" don't use them for font dictionaries; some do) — when
 * it finds nothing the caller falls back to pdfjs's generic sans/serif/monospace bucket.
 */
function _extractPdfBaseFontNames(data: Uint8Array): string[] {
  const raw = Buffer.from(data).toString('latin1');
  const names: string[] = [];
  for (const m of raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9#+,]+)/g)) {
    names.push(m[1].replace(/^[A-Z]{6}\+/, ''));
  }
  return names;
}

/**
 * Split recovered font names into a body font (the family used across the most distinct
 * weights — Regular/Bold/etc. — a strong signal it's the workhorse body font) and, if a
 * second distinct family is present, a heading font (used for just one or two weights,
 * typically a name/title in a display font). Best-effort: on a single-font document,
 * `headingFont` comes back undefined and the caller falls back to `bodyFont` for both.
 */
function _pickPdfHeadingBodyFonts(names: string[]): { bodyFont?: string; headingFont?: string } {
  const variantsByFamily = new Map<string, Set<string>>();
  for (const name of names) {
    const family = name.replace(/[-\s]?(Regular|Bold|SemiBold|Semibold|Medium|Light|Thin|Black|Heavy|ExtraBold|Italic|Oblique)+$/i, '').trim();
    if (!family) continue;
    if (!variantsByFamily.has(family)) variantsByFamily.set(family, new Set());
    variantsByFamily.get(family)!.add(name);
  }
  const families = Array.from(variantsByFamily.entries()).sort((a, b) => b[1].size - a[1].size);
  if (families.length === 0) return {};
  const bodyFont = families[0][0];
  const headingFont = families.length > 1 ? families[1][0] : undefined;
  return { bodyFont, headingFont };
}

// ---------------------------------------------------------------------------
// Shared OOXML (DOCX/PPTX) tree-walking helpers.
//
// Both formats are a zip of XML parts. We parse with fast-xml-parser's `preserveOrder: true`
// mode, which keeps sibling elements of different tag names in their original document order
// (the default object-shape mode would group same-named siblings into arrays and lose the
// interleaving between e.g. paragraphs and tables) — required for correct reading order.
// Each node in that tree looks like `{ "<tag>": [...children], ":@"?: { "@_attr": "value" } }`.
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

async function _loadXmlPart(zip: import('jszip'), path: string): Promise<string | undefined> {
  return zip.file(path)?.async('string');
}

function _xmlParser(): import('fast-xml-parser').XMLParser {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { XMLParser } = require('fast-xml-parser') as typeof import('fast-xml-parser');
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    // Word/PowerPoint mark meaningful runs of whitespace with xml:space="preserve"; the
    // default trimming would silently glue adjacent words together across run boundaries.
    trimValues: false,
  });
}

/** Read a `:@` attribute map off a node, if present. */
function _attrsOf(node: unknown): Record<string, unknown> | undefined {
  const rec = node as XmlNode | undefined;
  return rec?.[':@'] as Record<string, unknown> | undefined;
}

/** Find the first descendant with the given tag among `children` and return its `:@` attrs. */
function _findAttrs(children: unknown, tag: string): Record<string, unknown> | undefined {
  if (!Array.isArray(children)) return undefined;
  for (const node of children) {
    const rec = node as XmlNode;
    if (rec && tag in rec) return _attrsOf(rec) || {};
  }
  return undefined;
}

function _findAttr(children: unknown, tag: string, attr: string): string | undefined {
  const at = _findAttrs(children, tag);
  const v = at?.[`@_${attr}`];
  return typeof v === 'string' ? v : undefined;
}

/** Concatenate `#text` leaves under a parsed leaf element's children array. */
function _textOf(node: unknown): string {
  if (!Array.isArray(node)) return '';
  return node
    .map((n) => {
      const rec = n as XmlNode;
      return typeof rec?.['#text'] === 'string' ? (rec['#text'] as string) : '';
    })
    .join('');
}

/** Generic recursive search for every element with `tag`, anywhere in the tree. */
function _walkFind(nodes: unknown, tag: string, cb: (attrs: Record<string, unknown>) => void): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const rec = node as XmlNode;
    for (const key of Object.keys(rec)) {
      if (key === ':@' || key === '#text') continue;
      if (key === tag) cb(_attrsOf(rec) || {});
      _walkFind(rec[key], tag, cb);
    }
  }
}

/** Wrap a run's text in the shared bold/italic markdown convention (bold takes priority when a
 *  run is somehow both, since the exporter/editor only round-trip single-level emphasis). */
function _wrapEmphasis(text: string, bold: boolean, italic: boolean): string {
  if (!text.trim()) return text;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

interface DocxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  font?: string;
  color?: string;
}

interface DocxParagraph {
  runs: DocxRun[];
  styleId?: string;
}

function _hasFlag(children: unknown, tag: string): boolean {
  const at = _findAttrs(children, tag);
  if (!at) return false;
  const v = at['@_w:val'];
  // A bare <w:b/> (no w:val) means true; w:val="0"/"false" explicitly turns it back off.
  return v === undefined || (v !== '0' && v !== 'false');
}

function _extractDocxRun(children: unknown): DocxRun {
  const run: DocxRun = { text: '', bold: false, italic: false };
  if (!Array.isArray(children)) return run;
  for (const node of children) {
    const rec = node as XmlNode;
    if (!rec) continue;
    if ('w:rPr' in rec) {
      const props = rec['w:rPr'];
      run.bold = _hasFlag(props, 'w:b');
      run.italic = _hasFlag(props, 'w:i');
      const font = _findAttr(props, 'w:rFonts', 'w:ascii');
      if (font) run.font = font;
      const color = _findAttr(props, 'w:color', 'w:val');
      if (color && /^[0-9a-fA-F]{6}$/.test(color)) run.color = color;
      continue;
    }
    if ('w:t' in rec) { run.text += _textOf(rec['w:t']); continue; }
    if ('w:tab' in rec) { run.text += '\t'; continue; }
    if ('w:br' in rec || 'w:cr' in rec) { run.text += '\n'; continue; }
  }
  return run;
}

function _extractDocxParagraph(children: unknown): DocxParagraph {
  const paragraph: DocxParagraph = { runs: [] };
  if (!Array.isArray(children)) return paragraph;
  for (const node of children) {
    const rec = node as XmlNode;
    if (!rec) continue;
    if ('w:pPr' in rec) {
      const styleId = _findAttr(rec['w:pPr'], 'w:pStyle', 'w:val');
      if (styleId) paragraph.styleId = styleId;
      continue;
    }
    if ('w:r' in rec) { paragraph.runs.push(_extractDocxRun(rec['w:r'])); continue; }
    if ('w:hyperlink' in rec) {
      // Visible run text only — no URL recovery for DOCX hyperlinks (out of scope; matches
      // the prior mammoth-based behavior, which also only surfaced the visible text).
      const inner = rec['w:hyperlink'];
      if (Array.isArray(inner)) {
        for (const n of inner) {
          const r = n as XmlNode;
          if (r && 'w:r' in r) paragraph.runs.push(_extractDocxRun(r['w:r']));
        }
      }
    }
  }
  return paragraph;
}

/** Recursively find every `w:p` (paragraph) in the tree, including inside tables, in order. */
function _walkDocxBody(nodes: unknown, out: DocxParagraph[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const rec = node as XmlNode;
    for (const key of Object.keys(rec)) {
      if (key === ':@' || key === '#text') continue;
      if (key === 'w:p') out.push(_extractDocxParagraph(rec[key]));
      else _walkDocxBody(rec[key], out);
    }
  }
}

/** Merge adjacent runs sharing the same emphasis so markdown wrapping stays clean, then wrap. */
function _docxParagraphToLine(p: DocxParagraph): string {
  const merged: DocxRun[] = [];
  for (const r of p.runs) {
    if (!r.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.bold === r.bold && prev.italic === r.italic) prev.text += r.text;
    else merged.push({ ...r });
  }
  return merged.map((r) => _wrapEmphasis(r.text, r.bold, r.italic)).join('');
}

function _docxStyleHints(paragraphs: DocxParagraph[]): StyleHints | undefined {
  const bodyFonts = new Map<string, number>();
  const headingFonts = new Map<string, number>();
  let accentColor: string | undefined;

  for (const p of paragraphs) {
    const isHeading = !!p.styleId && /^(heading|title)/i.test(p.styleId);
    for (const r of p.runs) {
      if (!r.text.trim()) continue;
      const bucket = isHeading ? headingFonts : bodyFonts;
      if (r.font) bucket.set(r.font, (bucket.get(r.font) || 0) + r.text.length);
      if (isHeading && r.color && !accentColor) accentColor = r.color;
    }
  }

  const bodyFont = _mostCommon(bodyFonts);
  const headingFont = _mostCommon(headingFonts) || bodyFont;
  if (!bodyFont && !headingFont && !accentColor) return undefined;
  return { bodyFont, headingFont, accentColor };
}

async function _parseDOCX(filePath: string): Promise<ParsedFile> {
  const JSZip = (await import('jszip')).default;
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const xml = await _loadXmlPart(zip, 'word/document.xml');
  if (!xml) throw new Error('word/document.xml not found in the .docx archive');

  const parsed = _xmlParser().parse(xml) as unknown[];
  const paragraphs: DocxParagraph[] = [];
  _walkDocxBody(parsed, paragraphs);

  return {
    text: paragraphs.map(_docxParagraphToLine).join('\n'),
    styleHints: _docxStyleHints(paragraphs),
  };
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

interface PptxRun {
  text: string;
  bold: boolean;
  italic: boolean;
  font?: string;
  color?: string;
}

interface PptxParagraph {
  runs: PptxRun[];
}

function _findLatinTypeface(children: unknown): string | undefined {
  if (!Array.isArray(children)) return undefined;
  for (const node of children) {
    const rec = node as XmlNode;
    if (rec && 'a:latin' in rec) {
      const v = _attrsOf(rec)?.['@_typeface'];
      if (typeof v === 'string') return v;
    }
  }
  return undefined;
}

function _findSolidFillColor(children: unknown): string | undefined {
  if (!Array.isArray(children)) return undefined;
  for (const node of children) {
    const rec = node as XmlNode;
    if (rec && 'a:solidFill' in rec) {
      const fill = rec['a:solidFill'];
      if (Array.isArray(fill)) {
        for (const fc of fill) {
          const fcRec = fc as XmlNode;
          if (fcRec && 'a:srgbClr' in fcRec) {
            const v = _attrsOf(fcRec)?.['@_val'];
            if (typeof v === 'string' && /^[0-9a-fA-F]{6}$/.test(v)) return v;
          }
        }
      }
    }
  }
  return undefined;
}

function _extractPptxRun(children: unknown): PptxRun {
  const run: PptxRun = { text: '', bold: false, italic: false };
  if (!Array.isArray(children)) return run;
  for (const node of children) {
    const rec = node as XmlNode;
    if (!rec) continue;
    if ('a:rPr' in rec) {
      const at = _attrsOf(rec);
      run.bold = at?.['@_b'] === '1';
      run.italic = at?.['@_i'] === '1';
      run.font = _findLatinTypeface(rec['a:rPr']);
      run.color = _findSolidFillColor(rec['a:rPr']);
      continue;
    }
    if ('a:t' in rec) run.text += _textOf(rec['a:t']);
  }
  return run;
}

function _extractPptxParagraph(children: unknown): PptxParagraph {
  const p: PptxParagraph = { runs: [] };
  if (!Array.isArray(children)) return p;
  for (const node of children) {
    const rec = node as XmlNode;
    if (rec && 'a:r' in rec) p.runs.push(_extractPptxRun(rec['a:r']));
  }
  return p;
}

/** Recursively find every `a:p` (paragraph) inside a slide's shape tree, in document order. */
function _walkPptxTree(nodes: unknown, out: PptxParagraph[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const rec = node as XmlNode;
    for (const key of Object.keys(rec)) {
      if (key === ':@' || key === '#text') continue;
      if (key === 'a:p') out.push(_extractPptxParagraph(rec[key]));
      else _walkPptxTree(rec[key], out);
    }
  }
}

function _pptxParagraphToLine(p: PptxParagraph): string {
  const merged: PptxRun[] = [];
  for (const r of p.runs) {
    if (!r.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.bold === r.bold && prev.italic === r.italic) prev.text += r.text;
    else merged.push({ ...r });
  }
  return merged.map((r) => _wrapEmphasis(r.text, r.bold, r.italic)).join('');
}

function _pptxStyleHints(paragraphs: PptxParagraph[]): StyleHints | undefined {
  const fonts = new Map<string, number>();
  let accentColor: string | undefined;
  for (const p of paragraphs) {
    for (const r of p.runs) {
      if (!r.text.trim()) continue;
      if (r.font) fonts.set(r.font, (fonts.get(r.font) || 0) + r.text.length);
      if (!accentColor && r.color) accentColor = r.color;
    }
  }
  const bodyFont = _mostCommon(fonts);
  if (!bodyFont && !accentColor) return undefined;
  return { bodyFont, accentColor };
}

/**
 * Resolve slide file paths in presentation order via presentation.xml's <p:sldIdLst> and its
 * relationship file — slide filenames on disk (slide1.xml, slide2.xml, …) don't reliably sort
 * in presentation order across every authoring tool, so this indirection matters.
 */
async function _resolvePptxSlideOrder(zip: import('jszip'), parser: import('fast-xml-parser').XMLParser): Promise<string[]> {
  try {
    const presXml = await _loadXmlPart(zip, 'ppt/presentation.xml');
    const relsXml = await _loadXmlPart(zip, 'ppt/_rels/presentation.xml.rels');
    if (!presXml || !relsXml) throw new Error('missing presentation parts');

    const relMap = new Map<string, string>();
    _walkFind(parser.parse(relsXml) as unknown[], 'Relationship', (attrs) => {
      const id = attrs['@_Id'];
      const target = attrs['@_Target'];
      if (typeof id === 'string' && typeof target === 'string') {
        relMap.set(id, target.replace(/^\.?\//, ''));
      }
    });

    const rIds: string[] = [];
    _walkFind(parser.parse(presXml) as unknown[], 'p:sldId', (attrs) => {
      const rid = attrs['@_r:id'];
      if (typeof rid === 'string') rIds.push(rid);
    });

    const order = rIds
      .map((id) => relMap.get(id))
      .filter((t): t is string => !!t)
      .map((t) => (t.startsWith('slides/') ? `ppt/${t}` : t));
    if (order.length) return order;
  } catch {
    // Fall through to the filename-sort fallback below.
  }

  const files = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  return files.sort((a, b) => {
    const na = parseInt(/slide(\d+)\.xml/.exec(a)?.[1] || '0', 10);
    const nb = parseInt(/slide(\d+)\.xml/.exec(b)?.[1] || '0', 10);
    return na - nb;
  });
}

async function _parsePPTX(filePath: string): Promise<ParsedFile> {
  const JSZip = (await import('jszip')).default;
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const parser = _xmlParser();

  const slideOrder = await _resolvePptxSlideOrder(zip, parser);

  const paragraphs: PptxParagraph[] = [];
  const slideBreaks: number[] = [];
  for (const slidePath of slideOrder) {
    const xml = await _loadXmlPart(zip, slidePath);
    if (!xml) continue;
    _walkPptxTree(parser.parse(xml) as unknown[], paragraphs);
    slideBreaks.push(paragraphs.length);
  }

  const lines = paragraphs.map(_pptxParagraphToLine);
  // Blank line between slides so section extraction sees them as distinct blocks.
  const withBreaks: string[] = [];
  let breakIdx = 0;
  lines.forEach((line, i) => {
    withBreaks.push(line);
    if (slideBreaks[breakIdx] === i + 1) { withBreaks.push(''); breakIdx++; }
  });

  return {
    text: withBreaks.join('\n').replace(/\n{3,}/g, '\n\n'),
    styleHints: _pptxStyleHints(paragraphs),
  };
}

async function _parseTXT(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath, 'utf8');
  return buffer;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Strip a whole-line bold/italic markdown wrapper before testing structural patterns (heading/
 * name detection) — a PDF/DOCX/PPTX-sourced emphasis on a heading or name line would otherwise
 * break the `^`-anchored classification regexes below. The wrapper itself is preserved in the
 * actual line text used for section content, only the classification check ignores it.
 */
function _stripEmphasis(line: string): string {
  const t = line.trim();
  const bold = /^\*\*(.+)\*\*$/.exec(t);
  if (bold) return bold[1];
  const italic = /^\*(.+)\*$/.exec(t);
  if (italic) return italic[1];
  return line;
}

/**
 * Section header patterns (case-insensitive).
 * Each key maps to an array of regex patterns that indicate the start of that section.
 */
const SECTION_PATTERNS: Record<string, RegExp[]> = {
  contact: [
    /^(contact(\s+information)?|personal(\s+details)?|about\s+me)\s*$/i,
  ],
  summary: [
    /^(summary|professional\s+summary|career\s+(summary|objective)|objective|profile|about|overview)\s*$/i,
  ],
  experience: [
    /^(experience|work\s+experience|employment(\s+history)?|professional\s+experience|career\s+history|work\s+history)\s*$/i,
  ],
  education: [
    /^(education|academic\s+(background|qualifications?)|qualifications?|degrees?)\s*$/i,
  ],
  skills: [
    /^(skills?|technical\s+skills?|core\s+(competencies|skills?)|competencies|expertise|technologies)\s*$/i,
  ],
  certifications: [
    /^(certifications?|certificates?|accreditations?|licenses?|credentials?)\s*$/i,
  ],
  projects: [
    /^(projects?|portfolio|personal\s+projects?|key\s+projects?|selected\s+projects?)\s*$/i,
  ],
  languages: [
    /^(languages?|spoken\s+languages?)\s*$/i,
  ],
  awards: [
    /^(awards?|honors?|achievements?|recognitions?)\s*$/i,
  ],
  publications: [
    /^(publications?|papers?|research|presentations?)\s*$/i,
  ],
  volunteer: [
    /^(volunteering?|volunteer\s+experience|community\s+service)\s*$/i,
  ],
};

/**
 * Identify which section key a line heading belongs to.
 * Returns null if no match.
 */
function _identifySection(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null;

  for (const [key, patterns] of Object.entries(SECTION_PATTERNS)) {
    if (patterns.some((p) => p.test(trimmed))) {
      return key;
    }
  }
  return null;
}

/**
 * Heuristic: a line looks like a section heading if it is:
 *  - ALL_CAPS, or
 *  - Title Case with no punctuation at end, or
 *  - Matches a known section pattern
 */
function _looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  // All caps (with possible spaces/hyphens)
  if (/^[A-Z][A-Z\s\-&/]+$/.test(t)) return true;
  // Ends in colon
  if (/:\s*$/.test(t)) return true;
  return false;
}

interface ContactInfo {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  playStore: string;
  appStore: string;
  website: string;
  links: string;
  raw: string;
  [key: string]: string;
}

// Words that disqualify a line from being a person's name (job titles, roles, headings).
const _NAME_BLOCKLIST = /\b(developer|engineer|manager|designer|architect|analyst|consultant|specialist|lead|senior|junior|intern|web|frontend|front-end|backend|back-end|fullstack|full-stack|software|director|officer|administrator|summary|profile|objective|resume|cv|curriculum|vitae|experience|education|skills?|contact|portfolio|linkedin)\b/i;

/**
 * Decide whether a line looks like a person's full name.
 * Tolerates ALL CAPS or Title Case, 2–4 tokens, letters only (incl. accents).
 */
function _looksLikeName(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 40) return false;
  if (/[@\d•|/]/.test(t)) return false; // contact lines, dates, separators
  if (_NAME_BLOCKLIST.test(t)) return false;
  const tokens = t.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 5) return false;
  // Every token must be a capitalised or all-caps word; allow accents, hyphen, apostrophe,
  // and a trailing/internal dot for honorifics & initials ("Dr.", "J.", "Nguyễn").
  return tokens.every((tok) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.-]*$/.test(tok) || /^[A-ZÀ-Ý'’.-]+$/.test(tok));
}

/**
 * A short headline/role line that typically sits right under the name — e.g.
 * "WEB DEVELOPER", "Senior Data Scientist", "Registered Nurse", "Product Manager".
 * Structural (shape + position), not tied to any specific profession or language,
 * so it generalises across CVs. Title is optional — when nothing qualifies it stays empty.
 */
function _looksLikeTitle(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 50) return false;
  if (/[@|•·,]/.test(t) || /\d/.test(t)) return false; // contact/location lines, not titles
  if (/\.$/.test(t)) return false; // titles aren't sentences (rejects a stray summary line)
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return false; // must contain letters
  if (t.split(/\s+/).length > 6) return false; // titles are short
  // Reject obvious section headings.
  return !/^(summary|profile|objective|experience|education|skills?|contact|projects?|about|work|employment)\b/i.test(t);
}

/**
 * Pull the location segment out of a contact line. The line is split on the common
 * separators (•, |, ·) and the segment that is neither an email, phone, nor URL — but
 * does contain letters — is treated as the location ("Tan Binh dist, HCMC, VietNam").
 */
function _extractLocationFromLine(line: string): string {
  const segments = line.split(/\s*[•|·]\s*/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    if (/[@]/.test(seg)) continue; // email
    if (/https?:\/\//i.test(seg)) continue; // url
    const digits = seg.replace(/\D/g, '');
    if (digits.length >= 7) continue; // phone
    if (!/[A-Za-zÀ-ÿ]/.test(seg)) continue; // must have letters
    if (_NAME_BLOCKLIST.test(seg)) continue; // not a role/section word
    if (seg.length > 60) continue;
    return seg;
  }
  return '';
}

/**
 * Attempt to extract the candidate's name and contact info from the first few lines.
 * pdf-parse can reflow text out of visual order, so the name is NOT reliably line 0 —
 * we score the first lines with a name heuristic instead.
 */
function _extractContact(lines: string[]): ContactInfo {
  const contact: ContactInfo = {
    name: '', title: '', email: '', phone: '', location: '', linkedin: '', github: '',
    portfolio: '', playStore: '', appStore: '', website: '', links: '', raw: '',
  };
  const contactLines: string[] = [];

  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;
    // Classification only ever looks at the de-emphasized text — see _stripEmphasis.
    const line = _stripEmphasis(rawLine);

    // Email
    const emailMatch = line.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    if (emailMatch && !contact.email) contact.email = emailMatch[0];

    // Phone
    const phoneMatch = line.match(/(\+?[\d\s\-().]{7,20})/);
    if (phoneMatch && !contact.phone) {
      const digits = phoneMatch[1].replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) contact.phone = phoneMatch[1].trim();
    }

    // Location — a contact line carries it alongside phone/email, separated by •|·,
    // e.g. "Tan Binh dist, HCMC, VietNam • +84 368197963 • email@x.com".
    if (!contact.location && (emailMatch || phoneMatch)) {
      const loc = _extractLocationFromLine(line);
      if (loc) contact.location = loc;
    }

    // Name — first line in the header block that looks like a person's name. Stored
    // de-emphasized: the header is already rendered bold by the template, so a source-bold
    // name carries no extra signal and literal ** markers would otherwise leak into the export.
    if (!contact.name && _looksLikeName(line)) contact.name = line;
    // Combined header like "DUONG DANG TUAN / BACKEND DEVELOPER" — common in designed
    // CVs and the only form OCR sees (name + role share one visual line). Split on the
    // separator and take the leading name segment, the rest as the title.
    else if (!contact.name && /[/|]/.test(line)) {
      const [head, ...rest] = line.split(/\s*[/|]\s*/);
      const tail = rest.join(' ').trim();
      if (_looksLikeName(head)) {
        contact.name = head.trim();
        if (!contact.title && _looksLikeTitle(tail)) contact.title = tail;
      }
    }
    // Title/headline — a role line (usually right after the name).
    else if (contact.name && !contact.title && _looksLikeTitle(line)) contact.title = line;

    contactLines.push(line);
  }

  // Capture any URLs visible in the text body (annotation-only links are added later).
  _mergeLinks(contact, _extractTextUrls(lines.join('\n')));

  contact.raw = contactLines.join('\n');
  return contact;
}

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

/** Classify a URL into a known contact link bucket. */
function _classifyUrl(url: string): keyof ContactInfo | null {
  const u = url.toLowerCase();
  if (/linkedin\.com/.test(u)) return 'linkedin';
  if (/github\.com/.test(u)) return 'github';
  if (/play\.google\.com/.test(u)) return 'playStore';
  if (/(apps\.apple\.com|itunes\.apple\.com)/.test(u)) return 'appStore';
  if (/(portfolio|\.dev|\.me|\.io|vercel\.app|netlify\.app|github\.io)/.test(u)) return 'portfolio';
  return 'website';
}

/** Pull visible http(s) URLs out of plain text. */
function _extractTextUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)>\]]+/gi) || [];
  return matches.map((m) => m.replace(/[.,;:]+$/, ''));
}

/** Merge a list of URLs into the contact buckets without overwriting existing values. */
function _mergeLinks(contact: ContactInfo, urls: string[]): void {
  const all = new Set((contact.links ? contact.links.split('\n') : []).filter(Boolean));
  for (const url of urls) {
    if (!url) continue;
    all.add(url);
    const bucket = _classifyUrl(url);
    if (bucket && !contact[bucket]) contact[bucket] = url;
  }
  contact.links = Array.from(all).join('\n');
}

/**
 * Extract clickable link-annotation URLs from a PDF (the kind pdf-parse drops).
 * Returns [] for non-PDFs or on any failure — link recovery is best-effort.
 */
export async function extractPdfLinks(filePath: string): Promise<string[]> {
  try {
    // pdfjs-dist v4 is ESM-only; load the Node legacy build via dynamic import.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.readFile(filePath));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const urls: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const a of annotations as Array<{ subtype?: string; url?: string; unsafeUrl?: string }>) {
        if (a.subtype === 'Link') {
          const url = a.url || a.unsafeUrl;
          if (url) urls.push(url.replace(/[.,;:]+$/, ''));
        }
      }
    }
    await doc.destroy();
    return Array.from(new Set(urls));
  } catch {
    return [];
  }
}

/** Merge externally-extracted URLs (e.g. PDF annotations) into already-parsed sections. */
export function mergeContactLinks(sections: CVSections, urls: string[]): void {
  if (!urls.length) return;
  _mergeLinks(sections.contact as ContactInfo, urls);
}

export interface LinkAnchor {
  url: string;
  text: string;
}

/**
 * Extract clickable link annotations together with the visible anchor text they cover,
 * by intersecting each Link annotation's rectangle with the page's text items. Lets us
 * preserve in-body links (e.g. "Google Play", "AppStore") that have no visible URL.
 * Returns [] for non-PDFs or on any failure — best-effort.
 */
export async function extractPdfLinkAnchors(filePath: string): Promise<LinkAnchor[]> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.readFile(filePath));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const anchors: LinkAnchor[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const annotations = (await page.getAnnotations({ intent: 'display' })) as Array<{
        subtype?: string; url?: string; unsafeUrl?: string; rect?: number[];
      }>;
      const linkAnns = annotations.filter((a) => a.subtype === 'Link' && (a.url || a.unsafeUrl) && a.rect);
      if (!linkAnns.length) continue;

      const content = await page.getTextContent();
      const items = (content.items as Array<{ str: string; transform: number[]; width?: number }>).filter(
        (it) => typeof it.str === 'string' && it.str.length > 0
      );

      for (const ann of linkAnns) {
        const [x1, y1, x2, y2] = ann.rect as number[];
        const loX = Math.min(x1, x2) - 1;
        const hiX = Math.max(x1, x2) + 1;
        const loY = Math.min(y1, y2) - 2;
        const hiY = Math.max(y1, y2) + 2;
        const covered = items
          .filter((it) => {
            const ix = it.transform[4];
            const iy = it.transform[5];
            const iw = it.width || 0;
            // Item overlaps the annotation box horizontally and sits within its vertical band.
            return ix + iw > loX && ix < hiX && iy >= loY && iy <= hiY;
          })
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((it) => it.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^[•·|,;:\s]+|[•·|,;:\s]+$/g, ''); // strip surrounding separators
        const url = (ann.url || ann.unsafeUrl || '').replace(/[.,;:]+$/, '');
        if (url && covered) anchors.push({ url, text: covered });
      }
    }

    await doc.destroy();
    return anchors;
  } catch {
    return [];
  }
}

/**
 * Embed annotation links into the raw text as markdown ([anchor](url)) so they survive
 * section extraction and AI rewriting, and can be rendered clickable on export.
 * Replaces the first un-linked occurrence of each anchor's text.
 */
export function injectLinkAnchors(text: string, anchors: LinkAnchor[]): string {
  let out = text;
  for (const { url, text: anchor } of anchors) {
    if (!anchor || anchor.length < 2) continue;
    if (/^https?:\/\//i.test(anchor)) continue; // visible URL already linkifies on render
    const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the anchor only when not already wrapped in markdown link syntax.
    const re = new RegExp(`(?<!\\]\\()(?<!\\[)${esc}(?!\\]\\()(?!\\]\\s*\\()`, '');
    if (re.test(out)) {
      out = out.replace(re, `[${anchor}](${url})`);
    }
  }
  return out;
}

/**
 * Split raw text into named CV sections.
 */
export function extractSections(text: string): CVSections {
  const sections: CVSections = {
    contact: {},
    summary: '',
    experience: '',
    education: '',
    skills: '',
    certifications: '',
    projects: '',
    languages: '',
    awards: '',
    publications: '',
    volunteer: '',
    other: '',
    raw: text,
  };

  const lines = text.split(/\r?\n/);
  sections.contact = _extractContact(lines);

  let currentSection: string | null = null;
  let seenKnown = false; // have we passed the contact header into a real section yet?
  const buffer: Record<string, string[]> = {};

  for (const line of lines) {
    const plainLine = _stripEmphasis(line);
    const sectionKey = _identifySection(plainLine) || (_looksLikeHeading(plainLine) ? '__heading__' : null);

    if (sectionKey && sectionKey !== '__heading__') {
      currentSection = sectionKey;
      seenKnown = true;
      if (!buffer[currentSection]) buffer[currentSection] = [];
      continue; // Don't include the heading itself in the content
    }

    if (sectionKey === '__heading__') {
      // Unknown heading. Before any known section this is the contact header (NAME, role,
      // contact line) — already parsed into `contact`, so skip it rather than dumping it
      // into "other" (which surfaced personal info under an ADDITIONAL section). Only route
      // genuinely unknown content to "other" once we're past the header.
      if (seenKnown && !currentSection) {
        currentSection = 'other';
        if (!buffer[currentSection]) buffer[currentSection] = [];
      }
      continue;
    }

    // Skip body lines that precede the first known section (the contact header block).
    if (!seenKnown) continue;

    if (currentSection) {
      if (!buffer[currentSection]) buffer[currentSection] = [];
      buffer[currentSection].push(line);
    }
  }

  // Convert buffers to strings, trim, assign
  const sectionKeys = Object.keys(sections) as Array<keyof CVSections>;
  for (const key of sectionKeys) {
    if (key === 'contact' || key === 'raw') continue;
    if (buffer[key as string]) {
      (sections[key] as string) = buffer[key as string].join('\n').trim();
    }
  }

  // If we couldn't find a summary section, try to infer it from first paragraph
  if (!sections.summary && lines.length > 3) {
    const firstParagraph = lines
      .slice(3, 15)
      .filter((l) => l.trim())
      .join(' ')
      .trim();
    if (firstParagraph.length > 80) {
      sections.summary = firstParagraph;
    }
  }

  return sections;
}
