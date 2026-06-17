/**
 * Exporter service — converts optimised CV sections into PDF or DOCX.
 *
 * PDF: generates a clean HTML string and renders it to a Buffer via
 *      a headless browser (puppeteer) when available, or falls back to
 *      returning the HTML itself (for environments where puppeteer isn't installed).
 *
 * DOCX: uses the `docx` npm package to build a proper Word document.
 */

import { CVSections } from '../routes/cv';

export interface ExportResult {
  buffer: Buffer;
  mimeType: string;
  extension: string;
}

interface ContactInfo {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  playStore?: string;
  appStore?: string;
  website?: string;
  links?: string;
  [key: string]: string | undefined;
}

// Personal contact links rendered under the name, in display order. Store links
// (Google Play / App Store) are product links, NOT personal info — they belong in the
// relevant Project entry, not the header — so they're intentionally excluded here.
const LINK_FIELDS: Array<{ key: keyof ContactInfo; label: string }> = [
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'github', label: 'GitHub' },
  { key: 'website', label: 'Website' },
];

/**
 * Rejoin lines that are visual wrap-continuations of the previous line.
 * PDF text extraction turns a single wrapped bullet into several hard lines; a line that
 * starts lowercase / with an opening bracket (and isn't itself an entry header) is a continuation.
 */
function _coalesceLines(content: string): string[] {
  const raw = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of raw) {
    const clean = line.replace(/^[-•*]\s*/, '');
    const prev = out.length ? out[out.length - 1] : '';
    // Continuation if it starts lowercase/bracket, OR the previous bullet ended mid-list (comma).
    const isContinuation =
      out.length > 0 &&
      !_isEntryHeader(line) &&
      (/^[a-z(,)]/.test(clean) || /,$/.test(prev.trim()));
    if (isContinuation) {
      out[out.length - 1] = `${out[out.length - 1]} ${clean}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Flatten markdown links to "text (url)" for the plain-text pdfkit fallback renderer. */
function _mdToPlain(s: string): string {
  return String(s).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');
}

/** A line inside Experience/Projects that names a role, company, or date range — rendered bold, no bullet. */
function _isEntryHeader(line: string): boolean {
  const t = line.replace(/^[-•*]\s*/, '').trim();
  if (!t) return false;
  if (/\b(\d{1,2}\/\d{4}|present)\b/i.test(t)) return true; // date range
  if (/\s\/\s/.test(t) && t.length < 80) return true; // "Company / Role"
  return false;
}

// ---------------------------------------------------------------------------
// PDF export — rendered with pdfkit (pure JS, no headless browser needed)
// ---------------------------------------------------------------------------

const PDF_SECTIONS: Array<{ title: string; key: keyof CVSections; bullets: boolean }> = [
  { title: 'Professional Summary', key: 'summary', bullets: false },
  { title: 'Experience', key: 'experience', bullets: true },
  { title: 'Education', key: 'education', bullets: true },
  { title: 'Skills', key: 'skills', bullets: true },
  { title: 'Certifications', key: 'certifications', bullets: true },
  { title: 'Projects', key: 'projects', bullets: true },
  { title: 'Languages', key: 'languages', bullets: true },
  { title: 'Awards & Honours', key: 'awards', bullets: true },
  { title: 'Publications', key: 'publications', bullets: true },
  { title: 'Volunteer Experience', key: 'volunteer', bullets: true },
  { title: 'Additional', key: 'other', bullets: true },
];

/** Draw a section heading with an underline rule, then its content. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _renderPdfSection(doc: any, title: string, content: string | undefined, asBullets: boolean): void {
  if (!content || !String(content).trim()) return;

  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a').text(title.toUpperCase(), { characterSpacing: 0.8 });
  const ruleY = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, ruleY)
    .lineTo(doc.page.width - doc.page.margins.right, ruleY)
    .lineWidth(1)
    .strokeColor('#1a1a1a')
    .stroke();
  doc.moveDown(0.5);

  doc.font('Helvetica').fontSize(10.5).fillColor('#1a1a1a');
  if (asBullets) {
    _coalesceLines(content)
      .forEach((rawLine) => {
        const line = _mdToPlain(rawLine);
        const clean = line.replace(/^[-•*]\s*/, '');
        if (_isEntryHeader(line)) {
          // Role / company / date lines stand out — bold, flush left, small gap above.
          doc.moveDown(0.25);
          doc.font('Helvetica-Bold').fontSize(10.5).text(clean, { paragraphGap: 2, lineGap: 1 });
          doc.font('Helvetica').fontSize(10.5);
        } else {
          doc.text(`•  ${clean}`, { indent: 8, paragraphGap: 3, lineGap: 1.5 });
        }
      });
  } else {
    // Non-bullet block (e.g. Summary): collapse hard line-wraps into one flowing paragraph.
    const para = _mdToPlain(content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' '));
    doc.text(para, { align: 'justify', paragraphGap: 4, lineGap: 1.5 });
  }
}

/**
 * Fallback PDF renderer using pdfkit (pure JS) — used when headless Chromium is unavailable.
 */
async function _exportWithPdfkit(sections: CVSections, meta: { name?: string } = {}): Promise<ExportResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const PDFDocument = require('pdfkit') as any;
  const contact = (sections.contact || {}) as ContactInfo;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 50, bottom: 50, left: 54, right: 54 },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Header — name + contact line
  const name = contact.name || meta.name || 'Candidate';
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#1a1a1a').text(name, { align: 'center', characterSpacing: 1 });

  const contactLine = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join('   |   ');
  if (contactLine) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#444').text(contactLine, { align: 'center' });
  }

  // Clickable links row (Portfolio, LinkedIn, GitHub, store links…)
  const links = LINK_FIELDS.filter((f) => contact[f.key]);
  if (links.length) {
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(9);
    const sep = '   |   ';
    // Center the whole chain by computing its start X, then render as one continued line.
    const fullLine = links.map((f) => f.label).join(sep);
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left + Math.max(0, (usableWidth - doc.widthOfString(fullLine)) / 2);
    const startY = doc.y;
    doc.fillColor('#1155cc').text('', startX, startY, { continued: true });
    links.forEach((f, i) => {
      const last = i === links.length - 1;
      doc.fillColor('#1155cc').text(f.label, { continued: true, underline: true, link: contact[f.key] as string });
      if (!last) doc.fillColor('#444').text(sep, { continued: true, underline: false, link: null });
    });
    // Flush the continued line.
    doc.fillColor('#1a1a1a').text('', { underline: false, link: null });
    doc.moveDown(0.4);
  }

  for (const s of PDF_SECTIONS) {
    _renderPdfSection(doc, s.title, sections[s.key] as string | undefined, s.bullets);
  }

  doc.end();
  const buffer = await finished;
  return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
}

// ---------------------------------------------------------------------------
// PDF export — HTML/CSS template rendered to PDF via headless Chromium.
// The template mirrors a clean, modern CV layout (centred name + role, justified
// summary, ruled section headers, hanging-indent bullets) so output matches a
// professionally designed CV rather than a bare text dump.
// ---------------------------------------------------------------------------

const HTML_SECTIONS: Array<{ title: string; key: keyof CVSections; kind: 'paragraph' | 'entries' | 'list' }> = [
  { title: 'Summary', key: 'summary', kind: 'paragraph' },
  { title: 'Skills', key: 'skills', kind: 'list' },
  { title: 'Work Experience', key: 'experience', kind: 'entries' },
  { title: 'Projects', key: 'projects', kind: 'entries' },
  { title: 'Education', key: 'education', kind: 'list' },
  { title: 'Certifications', key: 'certifications', kind: 'list' },
  { title: 'Languages', key: 'languages', kind: 'list' },
  { title: 'Awards & Honours', key: 'awards', kind: 'list' },
  { title: 'Publications', key: 'publications', kind: 'list' },
  { title: 'Volunteer Experience', key: 'volunteer', kind: 'entries' },
  { title: 'Additional', key: 'other', kind: 'list' }, // catch-all so no parsed content is dropped
];

const DATE_RANGE = /\s*((?:\d{1,2}\/\d{4}|\w+\s+\d{4})\s*[-–]\s*(?:\d{1,2}\/\d{4}|\w+\s+\d{4}|present|current|now))\s*$/i;

function _esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Markdown link [text](url) or a bare http(s) URL. Used to render in-body links clickable.
const INLINE_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<]+)/g;

/** Escape text while turning markdown links and bare URLs into clickable <a> tags. */
function _inlineHtml(s: string): string {
  const src = String(s);
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK.lastIndex = 0;
  while ((m = INLINE_LINK.exec(src)) !== null) {
    out += _esc(src.slice(last, m.index));
    if (m[1]) {
      out += `<a href="${_esc(m[2])}">${_esc(m[1])}</a>`;
    } else {
      const url = m[3].replace(/[.,;:]+$/, '');
      out += `<a href="${_esc(url)}">${_esc(url)}</a>`;
    }
    last = m.index + m[0].length;
  }
  out += _esc(src.slice(last));
  return out;
}

/**
 * Render an entry-style section (Experience/Projects). Each entry — its bold header
 * (with right-aligned date) plus all of its bullets — is wrapped in an `.entry-block`
 * that won't split across a page (a whole job/project stays together). An entry taller
 * than a page still breaks, which is unavoidable.
 */
function _htmlEntries(content: string): string {
  const lines = _coalesceLines(content);
  const out: string[] = [];
  let inBlock = false;
  let openUl = false;
  const closeUl = () => { if (openUl) { out.push('</ul>'); openUl = false; } };
  const closeBlock = () => { closeUl(); if (inBlock) { out.push('</div>'); inBlock = false; } };

  for (const line of lines) {
    const clean = line.replace(/^[-•*]\s*/, '').trim();
    const isLabel = /^[A-Z][A-Za-z &/]{0,28}:/.test(clean); // "Role:", "Frontend:", "Team Size:"
    if (_isEntryHeader(line) && !isLabel) {
      closeBlock();
      out.push('<div class="entry-block">');
      inBlock = true;
      const m = clean.match(DATE_RANGE);
      if (m) {
        const left = clean.slice(0, m.index).trim();
        out.push(`<div class="entry"><span class="entry-title">${_inlineHtml(left)}</span><span class="entry-date">${_esc(m[1])}</span></div>`);
      } else {
        out.push(`<div class="entry"><span class="entry-title">${_inlineHtml(clean)}</span></div>`);
      }
    } else {
      if (!openUl) { out.push('<ul>'); openUl = true; }
      if (isLabel) {
        const idx = clean.indexOf(':');
        const label = clean.slice(0, idx + 1);
        const rest = clean.slice(idx + 1);
        out.push(`<li><strong>${_esc(label)}</strong>${_inlineHtml(rest)}</li>`);
      } else {
        out.push(`<li>${_inlineHtml(clean)}</li>`);
      }
    }
  }
  closeBlock();
  return out.join('\n');
}

/**
 * A run-on "Cat A: …. Cat B: …. Cat C: …" blob (common in AI-expanded Skills) reads as one
 * giant bullet. Split it into one item per category so each is a clean, scannable line.
 */
function _splitCategoryRun(line: string): string[] {
  // Break before a Title-case label + colon that follows the end of the previous value
  // (a period/semicolon or just whitespace). Labels are 1–4 capitalised words (& / allowed).
  const marked = line.replace(
    /([.;])\s+(?=[A-Z][A-Za-z0-9.+#]*(?:[ &/]+[A-Z][A-Za-z0-9.+#]*){0,3}:\s)/g,
    (_m, punct) => `${punct}\n`
  );
  const parts = marked.split('\n').map((p) => p.trim().replace(/^[.;,\s]+/, '')).filter(Boolean);
  // Only treat as categories if at least two labelled segments emerged.
  const labelled = parts.filter((p) => /^[A-Z][A-Za-z0-9 .+#&/]{0,38}:\s/.test(p));
  return labelled.length >= 2 ? parts : [line];
}

/** Render a simple bullet list (Skills/Education/etc.), bolding "Label:" prefixes. */
function _htmlList(content: string): string {
  const items = _coalesceLines(content)
    .flatMap((line) => _splitCategoryRun(line.replace(/^[-•*]\s*/, '').trim()))
    .map((clean) => {
      const m = clean.match(/^([A-Z][A-Za-z &/]{0,30}):\s*(.*)$/);
      if (m) return `<li><strong>${_esc(m[1])}:</strong> ${_inlineHtml(m[2])}</li>`;
      return `<li>${_inlineHtml(clean)}</li>`;
    });
  return `<ul>\n${items.join('\n')}\n</ul>`;
}

/** Render a justified paragraph (Summary). */
function _htmlParagraph(content: string): string {
  const para = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  return `<p class="summary">${_inlineHtml(para)}</p>`;
}

/** Build the full HTML document for a CV. */
function _buildCvHtml(sections: CVSections, meta: { name?: string }): string {
  const contact = (sections.contact || {}) as ContactInfo;
  const name = contact.name || meta.name || 'Candidate';
  const title = contact.title || '';

  const contactLine = [contact.location, contact.phone, contact.email]
    .filter((v): v is string => Boolean(v))
    .map(_esc)
    .join(' • ');
  const links = LINK_FIELDS.filter((f) => contact[f.key])
    .map((f) => `<a href="${_esc(contact[f.key] as string)}">${_esc(f.label)}</a>`)
    .join('<span class="sep">•</span>');

  const body = HTML_SECTIONS.map((s) => {
    const content = sections[s.key] as string | undefined;
    if (!content || !String(content).trim()) return '';
    const inner =
      s.kind === 'paragraph' ? _htmlParagraph(content)
      : s.kind === 'entries' ? _htmlEntries(content)
      : _htmlList(content);
    return `<section><h2>${_esc(s.title)}</h2>${inner}</section>`;
  }).filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  /* Root font-size is the single scale knob; everything below is em/rem so it scales uniformly
     when the fitter adjusts it to fill pages. */
  html { font-size: 10.5pt; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif; color: #1a1a1a; font-size: 1rem; line-height: 1.42; }
  .name { text-align: center; font-size: 2.45rem; font-weight: 700; letter-spacing: 2px; }
  .title { text-align: center; font-size: 1.24rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-top: 0.2em; }
  .contact { text-align: center; font-size: 0.95rem; color: #333; margin-top: 0.62em; }
  .links { text-align: center; font-size: 0.95rem; margin-top: 0.26em; }
  .links a { color: #1155cc; text-decoration: underline; }
  .links .sep { color: #999; margin: 0 0.6em; }
  section a { color: #1155cc; text-decoration: underline; }
  section { margin-top: 1.15em; }
  /* Keep a heading with the content that follows it; otherwise let sections flow across pages. */
  h2 { font-size: 1.1rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
       border-bottom: 1.4px solid #1a1a1a; padding-bottom: 0.26em; margin-bottom: 0.6em;
       break-after: avoid; page-break-after: avoid; }
  p.summary { text-align: justify; orphans: 2; widows: 2; }
  ul { list-style: none; }
  /* Allow long (paragraph-style) bullets to break across pages rather than jumping whole
     and leaving a big gap; orphans/widows prevent ugly single-line splits. */
  li { position: relative; padding-left: 1.3em; margin-bottom: 0.32em; text-align: justify;
       orphans: 2; widows: 2; }
  li::before { content: "•"; position: absolute; left: 0.15em; color: #1a1a1a; }
  /* Let a long entry break across pages (so it fills the page instead of jumping whole and
     leaving a gap), but never strand the header alone — it stays glued to its first bullet. */
  .entry-block { break-inside: auto; page-break-inside: auto; }
  .entry { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.7em; margin-bottom: 0.15em;
           break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .entry-block > ul > li:first-child { break-before: avoid; page-break-before: avoid; }
  .entry-title { font-weight: 700; }
  .entry-date { font-weight: 700; white-space: nowrap; padding-left: 1em; }
</style></head>
<body>
  <header>
    <div class="name">${_esc(name)}</div>
    ${title ? `<div class="title">${_esc(title)}</div>` : ''}
    ${contactLine ? `<div class="contact">${contactLine}</div>` : ''}
    ${links ? `<div class="links">${links}</div>` : ''}
  </header>
  ${body}
</body></html>`;
}

// A4 printable area at 96dpi after 14mm vertical / 16mm horizontal margins.
const PAGE_CONTENT_PX = ((297 - 14 * 2) / 25.4) * 96; // ≈ 1016px tall
const PAGE_CONTENT_W_PX = Math.round(((210 - 16 * 2) / 25.4) * 96); // ≈ 673px wide
const BASE_PT = 10.5; // must match `html { font-size }` in the template

/**
 * Pick a root font scale so content fills the page(s) nicely: grow short CVs toward a full
 * page, and shrink a CV that spills only slightly onto an almost-empty extra page.
 * Scales via root font-size (em-based layout) so print pagination actually follows.
 * Clamped to a readable range so text never looks oversized or cramped.
 */
/**
 * Measure the real laid-out page count by simulating pagination: each atomic block
 * (entry-block, heading, list item) that would straddle a page boundary is pushed to the
 * next page, exactly like the print engine — so no-break blocks that leave gaps are counted.
 * Returns the bottom Y of the last block (gaps included).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _measureBottom(page: any): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atoms: Array<{ top: number; height: number; atomic: boolean }> = await page.evaluate(() => {
    const doc = (globalThis as any).document;
    // Atomic = must not split: page header, section headings, entry header lines, and list
    // items (entry bullets + skills/education). Entry blocks now break across pages, so each
    // bullet is its own atom. p.summary is breakable (long paragraph may flow across pages).
    const els = Array.from(
      doc.querySelectorAll('header, h2, p.summary, .entry, li')
    ) as any[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, atomic: !el.matches('p.summary') };
    });
  });

  const pageH = PAGE_CONTENT_PX;
  let shift = 0;
  let maxBottom = 0;
  for (const a of atoms) {
    let top = a.top + shift;
    if (a.atomic && a.height <= pageH) {
      const posInPage = top % pageH;
      if (posInPage + a.height > pageH + 0.5) {
        const jump = pageH - posInPage; // push block to start of next page
        shift += jump;
        top += jump;
      }
    }
    maxBottom = Math.max(maxBottom, top + a.height);
  }
  return maxBottom;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _fitToPages(page: any): Promise<void> {
  const MIN = 0.85; // never shrink below this — keeps text readable
  const MAX = 1.22; // never grow past this — keeps text from looking oversized
  let scale = 1;
  for (let i = 0; i < 6; i++) {
    await page.evaluate(
      (pt: number) => ((globalThis as any).document.documentElement.style.fontSize = pt + 'pt'),
      BASE_PT * scale
    );
    const bottom = await _measureBottom(page);
    const pages = Math.max(1, Math.ceil(bottom / PAGE_CONTENT_PX - 0.01));
    const bottomAtScale1 = bottom / scale; // scales ~linearly with the root font-size

    // 1) Shrink ONLY if it removes a whole page at a still-readable scale (compacts a
    //    sparse trailing page, e.g. one orphaned entry). Never shrink within the same
    //    page count — that just makes text small for no gain.
    if (pages > 1) {
      const sReq = ((pages - 1) * PAGE_CONTENT_PX * 0.985) / bottomAtScale1;
      if (sReq >= MIN && sReq < scale - 0.005) { scale = sReq; continue; }
    }

    // 2) Grow ONLY when the whole CV fits on a single page — growing a multi-page doc
    //    would overflow an unbreakable block onto the next page and leave a gap.
    if (pages === 1 && scale < MAX) {
      const target = Math.min(MAX, (PAGE_CONTENT_PX * 0.94) / bottomAtScale1);
      if (target > scale + 0.005) { scale = target; continue; }
    }
    break;
  }
}

/** Render HTML to a PDF buffer via headless Chromium. */
async function _renderHtmlToPdf(html: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const puppeteer = require('puppeteer') as any;
  const browser = await puppeteer.launch({
    headless: true,
    // Use the system Chromium in containers (PUPPETEER_EXECUTABLE_PATH); falls back to
    // puppeteer's bundled download locally where the env var isn't set.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // Measure under print media at the true printable width so scrollHeight matches
    // how page.pdf() will actually paginate (otherwise text wraps differently).
    await page.emulateMediaType('print');
    await page.setViewport({ width: PAGE_CONTENT_W_PX, height: Math.round(PAGE_CONTENT_PX), deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await _fitToPages(page);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '16mm', right: '16mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Export sections to a PDF. Primary path renders an HTML/CSS template through headless
 * Chromium for a polished, designed layout; falls back to pdfkit if Chromium is unavailable.
 */
export async function exportToPDF(sections: CVSections, meta: { name?: string } = {}): Promise<ExportResult> {
  try {
    const html = _buildCvHtml(sections, meta);
    const buffer = await _renderHtmlToPdf(html);
    return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
  } catch (err) {
    console.warn(`[exporter] HTML→PDF render failed, falling back to pdfkit: ${(err as Error).message}`);
    return _exportWithPdfkit(sections, meta);
  }
}

// ---------------------------------------------------------------------------
// DOCX export
// ---------------------------------------------------------------------------

/**
 * Export sections to a Word (.docx) file.
 */
export async function exportToDOCX(sections: CVSections): Promise<ExportResult> {
  const {
    Document,
    Paragraph,
    TextRun,
    ExternalHyperlink,
    HeadingLevel,
    AlignmentType,
    BorderStyle,
    UnderlineType,
    Packer,
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  } = require('docx') as any;

  const contact = (sections.contact || {}) as ContactInfo;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function nameBlock(): any[] {
    const name = contact.name || '';
    if (!name) return [];
    const blocks: any[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: name, bold: true, size: 40, font: 'Arial' })],
        spacing: { after: contact.title ? 20 : 60 },
      }),
    ];
    if (contact.title) {
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: contact.title.toUpperCase(), bold: true, size: 24, font: 'Arial' })],
          spacing: { after: 60 },
        })
      );
    }
    return blocks;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function contactBlock(): any[] {
    const blocks: any[] = [];
    const parts = [contact.email, contact.phone, contact.location]
      .filter(Boolean)
      .join('   |   ');
    if (parts) {
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: parts, size: 18, color: '555555', font: 'Arial' })],
          spacing: { after: contact.links ? 40 : 200 },
        })
      );
    }

    // Clickable links row
    const links = LINK_FIELDS.filter((f) => contact[f.key]);
    if (links.length) {
      const children: any[] = [];
      links.forEach((f, i) => {
        if (i > 0) children.push(new TextRun({ text: '   |   ', size: 18, color: '555555', font: 'Arial' }));
        children.push(
          new ExternalHyperlink({
            link: contact[f.key] as string,
            children: [
              new TextRun({
                text: f.label,
                size: 18,
                color: '1155CC',
                font: 'Arial',
                underline: { type: UnderlineType.SINGLE },
              }),
            ],
          })
        );
      });
      blocks.push(new Paragraph({ alignment: AlignmentType.CENTER, children, spacing: { after: 200 } }));
    }
    return blocks;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sectionHeading(title: string): any {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          size: 22,
          font: 'Arial',
          underline: { type: UnderlineType.SINGLE },
        }),
      ],
      border: {
        bottom: { color: '000000', space: 1, value: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { before: 200, after: 80 },
    });
  }

  // Split text into Word runs, turning markdown links / bare URLs into clickable hyperlinks.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function inlineRuns(text: string, opts: { bold?: boolean }): any[] {
    const runs: any[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    INLINE_LINK.lastIndex = 0;
    const pushText = (t: string) => {
      if (t) runs.push(new TextRun({ text: t, size: 20, bold: opts.bold, font: 'Arial' }));
    };
    while ((m = INLINE_LINK.exec(text)) !== null) {
      pushText(text.slice(last, m.index));
      const label = m[1] || m[3];
      const url = (m[2] || m[3]).replace(/[.,;:]+$/, '');
      runs.push(
        new ExternalHyperlink({
          link: url,
          children: [
            new TextRun({ text: label, size: 20, color: '1155CC', font: 'Arial', underline: { type: UnderlineType.SINGLE } }),
          ],
        })
      );
      last = m.index + m[0].length;
    }
    pushText(text.slice(last));
    return runs.length ? runs : [new TextRun({ text, size: 20, bold: opts.bold, font: 'Arial' })];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textToParagraphs(text: string | undefined): any[] {
    if (!text) return [];
    return _coalesceLines(text)
      .map((line) => {
        const isBullet = /^[-•*]/.test(line);
        const clean = line.replace(/^[-•*]\s*/, '');
        const header = _isEntryHeader(line);
        return new Paragraph({
          bullet: isBullet && !header ? { level: 0 } : undefined,
          children: inlineRuns(clean, { bold: header }),
          spacing: { after: 60 },
        });
      });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderSection(title: string, content: string | undefined): any[] {
    if (!content || !String(content).trim()) return [];
    return [sectionHeading(title), ...textToParagraphs(content)];
  }

  const children = [
    ...nameBlock(),
    ...contactBlock(),
    ...renderSection('Professional Summary', sections.summary),
    ...renderSection('Experience', sections.experience),
    ...renderSection('Education', sections.education),
    ...renderSection('Skills', sections.skills),
    ...renderSection('Certifications', sections.certifications),
    ...renderSection('Projects', sections.projects),
    ...renderSection('Languages', sections.languages),
    ...renderSection('Awards & Honours', sections.awards),
    ...renderSection('Publications', sections.publications),
    ...renderSection('Volunteer Experience', sections.volunteer),
    ...renderSection('Additional', sections.other),
  ].filter(Boolean);

  const doc = new Document({
    creator: 'CV Optimizer',
    description: 'Optimised CV',
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: 'docx',
  };
}
