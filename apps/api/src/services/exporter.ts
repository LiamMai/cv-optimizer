/**
 * Exporter service — converts optimised CV sections into PDF or DOCX.
 *
 * PDF: generates a clean HTML string and renders it to a Buffer via
 *      a headless browser (puppeteer) when available, or falls back to
 *      returning the HTML itself (for environments where puppeteer isn't installed).
 *
 * DOCX: uses the `docx` npm package to build a proper Word document.
 */

/// <reference lib="dom" />
// DOM lib is scoped to this file only (not the project tsconfig) — needed to type the
// `document`/`Element` globals referenced inside puppeteer's page.evaluate() callbacks
// below, which execute in the browser, not in this Node process.

import { CVSections, StyleHints } from '../routes/cv';
import type { Page } from 'puppeteer';

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
    const clean = line.replace(/^[-•*]\s+/, '');
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

export interface InlineRun {
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
}

/** Split a plain (no emphasis) segment into runs, resolving markdown links / bare URLs. */
function _parseLinkRuns(s: string, style: { bold?: boolean; italic?: boolean } = {}): InlineRun[] {
  const src = String(s);
  const runs: InlineRun[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK.lastIndex = 0;
  while ((m = INLINE_LINK.exec(src)) !== null) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index), ...style });
    if (m[1]) {
      runs.push({ text: m[1], href: m[2], ...style });
    } else {
      const url = m[3].replace(/[.,;:]+$/, '');
      runs.push({ text: url, href: url, ...style });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last), ...style });
  return runs;
}

const EMPHASIS = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;

/**
 * Parse bold/italic markdown (double/single asterisk wrapping) into inline runs, resolving
 * markdown links / bare URLs within each segment. Mirrors `parseInline` in
 * apps/web/src/lib/cvFormat.ts so the exported PDF/DOCX and the on-screen editor render the
 * same emphasis.
 */
function _parseInlineRuns(s: string): InlineRun[] {
  const src = String(s);
  const runs: InlineRun[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  EMPHASIS.lastIndex = 0;
  while ((m = EMPHASIS.exec(src)) !== null) {
    if (m.index > last) runs.push(..._parseLinkRuns(src.slice(last, m.index)));
    if (m[1] !== undefined) runs.push(..._parseLinkRuns(m[1], { bold: true }));
    else runs.push(..._parseLinkRuns(m[2] as string, { italic: true }));
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push(..._parseLinkRuns(src.slice(last)));
  return runs;
}

/** A line inside Experience/Projects that names a role, company, or date range — rendered bold, no bullet. */
function _isEntryHeader(line: string): boolean {
  const t = line.replace(/^[-•*]\s+/, '').trim();
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

interface PdfFontSet {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

const PDF_FONT_HELVETICA: PdfFontSet = {
  regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique',
};
const PDF_FONT_TIMES: PdfFontSet = {
  regular: 'Times-Roman', bold: 'Times-Bold', italic: 'Times-Italic', boldItalic: 'Times-BoldItalic',
};
const PDF_FONT_COURIER: PdfFontSet = {
  regular: 'Courier', bold: 'Courier-Bold', italic: 'Courier-Oblique', boldItalic: 'Courier-BoldOblique',
};

/**
 * pdfkit ships only the 14 standard PDF fonts (Helvetica/Times/Courier families) — an arbitrary
 * detected font name (e.g. "Calibri") can't be applied without bundling font files, so bucket
 * the extracted style hint into the nearest built-in family instead of passing it through.
 */
function _pdfFontSetFor(fontName: string | undefined): PdfFontSet {
  const n = (fontName || '').toLowerCase();
  if (/mono|courier|consolas|menlo|code/.test(n)) return PDF_FONT_COURIER;
  if (!/sans/.test(n) && /serif|times|georgia|garamond|cambria|book|palatino|minion/.test(n)) return PDF_FONT_TIMES;
  return PDF_FONT_HELVETICA;
}

function _pdfRunFont(fonts: PdfFontSet, bold?: boolean, italic?: boolean): string {
  if (bold && italic) return fonts.boldItalic;
  if (bold) return fonts.bold;
  if (italic) return fonts.italic;
  return fonts.regular;
}

/** Render inline runs (bold/italic/links) as one pdfkit paragraph via continued text chaining. */
function _pdfRenderRuns(
  doc: PDFKit.PDFDocument,
  runs: InlineRun[],
  fonts: PdfFontSet,
  baseOpts: PDFKit.Mixins.TextOptions = {}
): void {
  if (!runs.length) return;
  runs.forEach((r, i) => {
    const last = i === runs.length - 1;
    doc.font(_pdfRunFont(fonts, r.bold, r.italic));
    doc.fillColor(r.href ? '#1155cc' : '#1a1a1a');
    const opts: PDFKit.Mixins.TextOptions = { ...(i === 0 ? baseOpts : {}), continued: !last };
    if (r.href) {
      opts.underline = true;
      opts.link = r.href;
    }
    doc.text(r.text, opts);
  });
  doc.fillColor('#1a1a1a');
}

/** Draw a section heading with an underline rule, then its content. */
function _renderPdfSection(
  doc: PDFKit.PDFDocument,
  title: string,
  content: string | undefined,
  asBullets: boolean,
  fonts: PdfFontSet = PDF_FONT_HELVETICA
): void {
  if (!content || !String(content).trim()) return;

  doc.moveDown(0.7);
  doc.font(fonts.bold).fontSize(13).fillColor('#1a1a1a').text(title.toUpperCase(), { characterSpacing: 0.8 });
  const ruleY = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, ruleY)
    .lineTo(doc.page.width - doc.page.margins.right, ruleY)
    .lineWidth(1)
    .strokeColor('#1a1a1a')
    .stroke();
  doc.moveDown(0.5);

  doc.font(fonts.regular).fontSize(11).fillColor('#1a1a1a');
  if (asBullets) {
    _coalesceLines(content)
      .forEach((rawLine) => {
        const clean = rawLine.replace(/^[-•*]\s+/, '');
        if (_isEntryHeader(rawLine)) {
          // Role / company / date lines stand out — bold, flush left, small gap above.
          doc.moveDown(0.25);
          const headerRuns = _parseInlineRuns(clean).map((r) => ({ ...r, bold: true }));
          doc.fontSize(11);
          _pdfRenderRuns(doc, headerRuns, fonts, { paragraphGap: 2, lineGap: 1 });
          doc.font(fonts.regular).fontSize(11);
        } else {
          doc.text('•  ', { indent: 8, continued: true, paragraphGap: 3, lineGap: 1.5 });
          _pdfRenderRuns(doc, _parseInlineRuns(clean), fonts);
        }
      });
  } else {
    // Non-bullet block (e.g. Summary): collapse hard line-wraps into one flowing paragraph.
    const para = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
    _pdfRenderRuns(doc, _parseInlineRuns(para), fonts, { align: 'justify', paragraphGap: 4, lineGap: 1.5 });
  }
}

/**
 * Fallback PDF renderer using pdfkit (pure JS) — used when headless Chromium is unavailable.
 */
async function _exportWithPdfkit(
  sections: CVSections,
  meta: { name?: string } = {},
  styleHints?: StyleHints
): Promise<ExportResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit') as new (options: PDFKit.PDFDocumentOptions) => PDFKit.PDFDocument;
  const contact = (sections.contact || {}) as ContactInfo;
  const bodyFonts = _pdfFontSetFor(styleHints?.bodyFont);
  const headingFonts = _pdfFontSetFor(styleHints?.headingFont ?? styleHints?.bodyFont);

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
  doc.font(headingFonts.bold).fontSize(25).fillColor('#1a1a1a').text(name, { align: 'center', characterSpacing: 1 });

  const contactLine = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join('   |   ');
  if (contactLine) {
    doc.moveDown(0.2);
    doc.font(bodyFonts.regular).fontSize(9).fillColor('#444').text(contactLine, { align: 'center' });
  }

  // Clickable links row (Portfolio, LinkedIn, GitHub, store links…)
  const links = LINK_FIELDS.filter((f) => contact[f.key]);
  if (links.length) {
    doc.moveDown(0.15);
    doc.font(bodyFonts.regular).fontSize(9);
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
    _renderPdfSection(doc, s.title, sections[s.key] as string | undefined, s.bullets, bodyFonts);
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

/** Escape text while turning markdown emphasis/links and bare URLs into <strong>/<em>/<a> tags. */
function _inlineHtml(s: string): string {
  return _parseInlineRuns(s)
    .map((r) => {
      let t = _esc(r.text);
      if (r.href) t = `<a href="${_esc(r.href)}">${t}</a>`;
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
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
    const clean = line.replace(/^[-•*]\s+/, '').trim();
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
    .flatMap((line) => _splitCategoryRun(line.replace(/^[-•*]\s+/, '').trim()))
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

interface HtmlFontChoice {
  /** CSS font-family list, most-preferred first, ending in the current Inter default stack. */
  stack: string;
  /** Google Fonts css2 family spec, e.g. "Merriweather:wght@400;700". */
  googleSpec: string;
}

const HTML_FONT_SANS: HtmlFontChoice = {
  stack: 'Inter, "Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
  googleSpec: 'Inter:wght@400;700',
};
const HTML_FONT_SERIF: HtmlFontChoice = {
  stack: '"Merriweather", Georgia, "Times New Roman", Times, serif',
  googleSpec: 'Merriweather:wght@400;700',
};
const HTML_FONT_MONO: HtmlFontChoice = {
  stack: '"Roboto Mono", "Courier New", Courier, monospace',
  googleSpec: 'Roboto+Mono:wght@400;700',
};
// Metric-compatible substitutes for the handful of corporate/Office fonts detected CVs most
// often actually use — these are near-identical in shape/spacing to the original (each was
// purpose-built as a drop-in replacement), so a match here looks far closer to the source
// than falling back to the generic sans/serif bucket above.
const HTML_FONT_CARLITO: HtmlFontChoice = { // Calibri
  stack: '"Carlito", Calibri, Inter, "Segoe UI", sans-serif',
  googleSpec: 'Carlito:wght@400;700',
};
const HTML_FONT_ARIMO: HtmlFontChoice = { // Arial / Helvetica
  stack: '"Arimo", Arial, Helvetica, sans-serif',
  googleSpec: 'Arimo:wght@400;700',
};
const HTML_FONT_TINOS: HtmlFontChoice = { // Times New Roman
  stack: '"Tinos", "Times New Roman", Times, serif',
  googleSpec: 'Tinos:wght@400;700',
};
const HTML_FONT_GELASIO: HtmlFontChoice = { // Georgia
  stack: '"Gelasio", Georgia, serif',
  googleSpec: 'Gelasio:wght@400;700',
};
const HTML_FONT_CALADEA: HtmlFontChoice = { // Cambria
  stack: '"Caladea", Cambria, Georgia, serif',
  googleSpec: 'Caladea:wght@400;700',
};

/**
 * Chromium renders this template server-side in a minimal container with no arbitrary system
 * fonts installed (per CLAUDE.md, even the current Inter webfont depends on reaching Google
 * Fonts at render time) — passing a detected font name straight through as CSS would silently
 * no-op in prod. Bucket it into a small curated Google-Fonts-available set instead — checking
 * specific, commonly-detected corporate fonts first (metric-compatible substitutes, so the
 * result actually resembles the source) before falling back to a generic sans/serif/mono
 * guess for anything else. A font with no available substitute (e.g. a specialty display font
 * used just for a name/heading) has no metric-compatible option and falls through to the
 * generic bucket — there's no way to reproduce it without embedding the source file itself.
 */
function _htmlFontFor(fontName: string | undefined): HtmlFontChoice {
  const n = (fontName || '').toLowerCase();
  if (/calibri/.test(n)) return HTML_FONT_CARLITO;
  if (/cambria/.test(n)) return HTML_FONT_CALADEA;
  if (/georgia/.test(n)) return HTML_FONT_GELASIO;
  if (/times/.test(n)) return HTML_FONT_TINOS;
  if (/arial|helvetica/.test(n)) return HTML_FONT_ARIMO;
  if (/mono|courier|consolas|menlo|code/.test(n)) return HTML_FONT_MONO;
  if (!/sans/.test(n) && /serif|garamond|book|palatino|minion/.test(n)) return HTML_FONT_SERIF;
  return HTML_FONT_SANS;
}

/** Validate + guard a detected accent color: only a real 6-hex value, and never one too light
 *  to read (heading text/rules only ever use this — body text stays a safe near-black). */
function _safeAccentColor(hex: string | undefined): string {
  const m = hex ? /^#?([0-9a-fA-F]{6})$/.exec(hex) : null;
  if (!m) return '#1a1a1a';
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.75 ? '#1a1a1a' : `#${v}`;
}

/** Build the full HTML document for a CV. */
function _buildCvHtml(sections: CVSections, meta: { name?: string }, styleHints?: StyleHints): string {
  const contact = (sections.contact || {}) as ContactInfo;
  const name = contact.name || meta.name || 'Candidate';
  const title = contact.title || '';

  const bodyFont = _htmlFontFor(styleHints?.bodyFont);
  const headingFont = styleHints?.headingFont ? _htmlFontFor(styleHints.headingFont) : bodyFont;
  const accent = _safeAccentColor(styleHints?.accentColor);
  const googleSpecs = Array.from(new Set([bodyFont.googleSpec, headingFont.googleSpec]));

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
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${googleSpecs.join('&family=')}&display=swap" rel="stylesheet">
<style>
  /* Root font-size is the single scale knob; everything below is em/rem so it scales uniformly
     when the fitter adjusts it to fill pages. Base = 11pt body text. */
  html { font-size: 11pt; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: ${bodyFont.stack}; color: #1a1a1a; font-size: 1rem; line-height: 1.42; }
  .name { font-family: ${headingFont.stack}; text-align: center; font-size: 2.27rem; font-weight: 700; letter-spacing: 2px; } /* 25pt */
  .title { font-family: ${headingFont.stack}; text-align: center; font-size: 1.36rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-top: 0.2em; } /* 15pt */
  .contact { text-align: center; font-size: 0.9rem; color: #333; margin-top: 0.62em; }
  .links { text-align: center; font-size: 0.9rem; margin-top: 0.26em; }
  .links a { color: #1155cc; text-decoration: underline; }
  .links .sep { color: #999; margin: 0 0.6em; }
  section a { color: #1155cc; text-decoration: underline; }
  section { margin-top: 1.15em; }
  /* Keep a heading with the content that follows it; otherwise let sections flow across pages. */
  h2 { font-family: ${headingFont.stack}; color: ${accent}; font-size: 1.18rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; /* 13pt */
       border-bottom: 1.4px solid ${accent}; padding-bottom: 0.26em; margin-bottom: 0.6em;
       break-after: avoid; page-break-after: avoid; }
  p.summary { text-align: justify; orphans: 2; widows: 2; }
  ul { list-style: none; }
  /* Bullets split at text-line boundaries so pages fill completely; orphans/widows
     keep at least 2 lines on each side of a split. */
  li { position: relative; padding-left: 1.3em; margin-bottom: 0.32em; text-align: justify;
       orphans: 2; widows: 2; }
  li::before { content: "•"; position: absolute; left: 0.15em; color: #1a1a1a; }
  /* Entries (job/project header + bullets) break across pages so every page fills —
     no big blanks. The unbreakable lead chunk is the header + the first lines of its
     first bullet (orphans:2), so a header is never stranded at a page bottom. One-line
     bullets (e.g. "Role:"/"Team Size:" style metadata) glue to whatever follows them too
     — the .brief class is added by _measureBottom's page.evaluate() right before printing
     — otherwise a header could be stranded with only trivial metadata while the entry's
     real content lands alone on the next page. Mirrors paginate()/minChunk in the web
     preview (CvPaper.tsx). */
  .entry-block { break-inside: auto; page-break-inside: auto; }
  .entry { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.7em; margin-bottom: 0.15em;
           break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid; }
  .entry-block > ul > li:first-child { break-before: avoid; page-break-before: avoid; }
  .entry-block > ul > li.brief + li { break-before: avoid; page-break-before: avoid; }
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
const BASE_PT = 11; // must match `html { font-size }` in the template

/**
 * Pick a root font scale so content fills the page(s) nicely: grow short CVs toward a full
 * page, and shrink a CV that spills only slightly onto an almost-empty extra page.
 * Scales via root font-size (em-based layout) so print pagination actually follows.
 * Clamped to a readable range so text never looks oversized or cramped.
 */
/**
 * Measure the real laid-out page count by simulating pagination: each atomic block
 * (entry lead chunk, heading, list item) that would straddle a page boundary is pushed to
 * the next page, exactly like the print engine — so no-break blocks that leave gaps are
 * counted. An entry's header is merged with any leading run of one-line "metadata" bullets
 * (e.g. "Role:"/"Team Size:") plus the first substantial bullet into one atomic lead chunk,
 * mirroring `minChunk()` in the web preview (CvPaper.tsx) — otherwise the header could be
 * stranded with only trivial metadata while the entry's real content lands on the next page.
 * Remaining bullets and the summary paragraph are only left to split in place when the print
 * engine's `orphans:2`/`widows:2` rule would actually allow it (≥2 lines fit on each side);
 * otherwise they're pushed whole, mirroring `placeFlow()` in the web preview's `paginate()`
 * (CvPaper.tsx) — keep the two in sync.
 * Also marks one-line entry bullets with `.brief` (consumed by the template's
 * `.entry-block > ul > li.brief + li` CSS rule) so the real print pagination matches.
 * Returns the bottom Y of the last block (gaps included).
 */
async function _measureBottom(page: Page): Promise<number> {
  const atoms: Array<{ top: number; height: number; atomic: boolean; lineH: number; lines: number }> =
    await page.evaluate(() => {
      // Mark bullets that render as exactly one line so CSS glues them to whatever
      // follows them (see `.entry-block > ul > li.brief + li` in the template CSS).
      document.querySelectorAll('.entry-block > ul').forEach((ul) => {
        Array.from(ul.children).forEach((li) => {
          const lh = parseFloat(getComputedStyle(li).lineHeight);
          const h = li.getBoundingClientRect().height;
          li.classList.toggle('brief', !!lh && isFinite(lh) && Math.round(h / lh) === 1);
        });
      });

      const lineMeta = (el: Element) => {
        const r = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        const valid = !!lh && isFinite(lh);
        return {
          top: r.top,
          height: r.height,
          lineH: valid ? lh : 0,
          lines: valid ? Math.max(1, Math.round(r.height / lh)) : 1,
        };
      };

      const nodes = Array.from(document.querySelectorAll('header, h2, p.summary, .entry, li'));
      const out: Array<{ top: number; height: number; atomic: boolean; lineH: number; lines: number }> = [];
      for (let idx = 0; idx < nodes.length; idx++) {
        const el = nodes[idx];
        if (el.matches('.entry')) {
          // Merge the header with its lead chunk: any leading one-line bullets, plus the
          // first substantial bullet whole — one non-splittable unit.
          const m = lineMeta(el);
          let height = m.height;
          let j = idx + 1;
          while (j < nodes.length && nodes[j].matches('li')) {
            const lm = lineMeta(nodes[j]);
            height += lm.height;
            j++;
            if (lm.lines !== 1) break; // first substantial bullet ends the lead chunk
          }
          out.push({ top: m.top, height, atomic: true, lineH: 0, lines: 1 });
          idx = j - 1; // resume after the consumed lead bullets
          continue;
        }
        if (el.matches('li')) {
          const m = lineMeta(el);
          out.push({ top: m.top, height: m.height, atomic: false, lineH: m.lineH, lines: m.lines });
          continue;
        }
        // header / h2 (atomic) or p.summary (splits like a bullet, via orphans/widows).
        const m = lineMeta(el);
        out.push({ top: m.top, height: m.height, atomic: el.matches('header, h2'), lineH: m.lineH, lines: m.lines });
      }
      return out;
    });

  const pageH = PAGE_CONTENT_PX;
  let shift = 0;
  let maxBottom = 0;
  for (const a of atoms) {
    let top = a.top + shift;
    if (a.height <= pageH) {
      const posInPage = top % pageH;
      const overflow = posInPage + a.height > pageH + 0.5;
      if (overflow) {
        // Splittable (li/p.summary): a real orphans:2/widows:2 split is only valid when
        // at least 2 whole lines fit in the remaining room and at least 2 lines remain
        // for the next page — otherwise the print engine pushes the whole block, same as
        // an atomic one.
        const roomLines = a.lineH ? Math.floor((pageH - posInPage) / a.lineH) : 0;
        const validSplit = !a.atomic && a.lineH > 0 && a.lines >= 4 && roomLines >= 2 && a.lines - roomLines >= 2;
        if (!validSplit) {
          const jump = pageH - posInPage; // push block to start of next page
          shift += jump;
          top += jump;
        }
      }
    }
    maxBottom = Math.max(maxBottom, top + a.height);
  }
  return maxBottom;
}

async function _fitToPages(page: Page): Promise<void> {
  const MIN = 0.85; // never shrink below this — keeps text readable
  const MAX = 1.22; // never grow past this — keeps text from looking oversized
  let scale = 1;
  for (let i = 0; i < 6; i++) {
    await page.evaluate(
      (pt: number) => (document.documentElement.style.fontSize = pt + 'pt'),
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const puppeteer = require('puppeteer') as typeof import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    // Use the system Chromium in containers (API_PUPPETEER_EXECUTABLE_PATH); falls back to
    // puppeteer's bundled download locally where the env var isn't set.
    executablePath: process.env.API_PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // Measure under print media at the true printable width so scrollHeight matches
    // how page.pdf() will actually paginate (otherwise text wraps differently).
    await page.emulateMediaType('print');
    await page.setViewport({ width: PAGE_CONTENT_W_PX, height: Math.round(PAGE_CONTENT_PX), deviceScaleFactor: 1 });
    // puppeteer's types disallow 'networkidle0' here (only for goto()/waitForNavigation()),
    // but it's still accepted at runtime and is what actually waits for the Google Fonts
    // <link> stylesheet (see CLAUDE.md: silent Helvetica fallback if it doesn't load) to
    // finish before we measure/paginate.
    await page.setContent(html, { waitUntil: 'networkidle0' } as unknown as Parameters<Page['setContent']>[1]);
    // Ensure the Inter webfont has been applied before measuring — a late font swap
    // changes line wraps and would invalidate the pagination measurement.
    await page.evaluate(() => document.fonts.ready).catch(() => {});
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
export async function exportToPDF(
  sections: CVSections,
  meta: { name?: string } = {},
  styleHints?: StyleHints
): Promise<ExportResult> {
  try {
    const html = _buildCvHtml(sections, meta, styleHints);
    const buffer = await _renderHtmlToPdf(html);
    return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
  } catch (err) {
    console.warn(`[exporter] HTML→PDF render failed, falling back to pdfkit: ${(err as Error).message}`);
    return _exportWithPdfkit(sections, meta, styleHints);
  }
}

// ---------------------------------------------------------------------------
// DOCX export
// ---------------------------------------------------------------------------

/**
 * Export sections to a Word (.docx) file. Rendering happens on the user's own machine in
 * their own Word/viewer, so — unlike the server-side Puppeteer/pdfkit renderers — a detected
 * font name can be passed straight through; Word silently substitutes if it isn't installed.
 */
export async function exportToDOCX(sections: CVSections, styleHints?: StyleHints): Promise<ExportResult> {
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  } = require('docx') as typeof import('docx');

  const contact = (sections.contact || {}) as ContactInfo;
  const bodyFont = styleHints?.bodyFont || 'Inter';
  const headingFont = styleHints?.headingFont || bodyFont;
  const accent = /^#?[0-9a-fA-F]{6}$/.test(styleHints?.accentColor || '')
    ? (styleHints!.accentColor as string).replace('#', '').toUpperCase()
    : '000000';

  function nameBlock(): InstanceType<typeof Paragraph>[] {
    const name = contact.name || '';
    if (!name) return [];
    const blocks: InstanceType<typeof Paragraph>[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: name, bold: true, size: 50, font: headingFont })],
        spacing: { after: contact.title ? 20 : 60 },
      }),
    ];
    if (contact.title) {
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: contact.title.toUpperCase(), bold: true, size: 30, font: headingFont })],
          spacing: { after: 60 },
        })
      );
    }
    return blocks;
  }

  function contactBlock(): InstanceType<typeof Paragraph>[] {
    const blocks: InstanceType<typeof Paragraph>[] = [];
    const parts = [contact.email, contact.phone, contact.location]
      .filter(Boolean)
      .join('   |   ');
    if (parts) {
      blocks.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: parts, size: 18, color: '555555', font: bodyFont })],
          spacing: { after: contact.links ? 40 : 200 },
        })
      );
    }

    // Clickable links row
    const links = LINK_FIELDS.filter((f) => contact[f.key]);
    if (links.length) {
      const children: Array<InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>> = [];
      links.forEach((f, i) => {
        if (i > 0) children.push(new TextRun({ text: '   |   ', size: 18, color: '555555', font: bodyFont }));
        children.push(
          new ExternalHyperlink({
            link: contact[f.key] as string,
            children: [
              new TextRun({
                text: f.label,
                size: 18,
                color: '1155CC',
                font: bodyFont,
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

  function sectionHeading(title: string): InstanceType<typeof Paragraph> {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: title.toUpperCase(),
          bold: true,
          size: 26,
          font: headingFont,
          color: accent,
          underline: { type: UnderlineType.SINGLE },
        }),
      ],
      border: {
        bottom: { color: accent, space: 1, style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { before: 200, after: 80 },
    });
  }

  // Split text into Word runs, applying **bold**/*italic* markdown and turning markdown
  // links / bare URLs into clickable hyperlinks.
  function inlineRuns(
    text: string,
    opts: { bold?: boolean } = {}
  ): Array<InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>> {
    const parsed = _parseInlineRuns(text).map((r) => (opts.bold ? { ...r, bold: true } : r));
    if (!parsed.length) return [new TextRun({ text, size: 22, bold: opts.bold, font: bodyFont })];
    return parsed.map((r) => {
      const run = new TextRun({
        text: r.text,
        size: 22,
        bold: r.bold,
        italics: r.italic,
        color: r.href ? '1155CC' : undefined,
        font: bodyFont,
        underline: r.href ? { type: UnderlineType.SINGLE } : undefined,
      });
      return r.href ? new ExternalHyperlink({ link: r.href, children: [run] }) : run;
    });
  }

  function textToParagraphs(text: string | undefined): InstanceType<typeof Paragraph>[] {
    if (!text) return [];
    return _coalesceLines(text)
      .map((line) => {
        const isBullet = /^[-•*]/.test(line);
        const clean = line.replace(/^[-•*]\s+/, '');
        const header = _isEntryHeader(line);
        return new Paragraph({
          bullet: isBullet && !header ? { level: 0 } : undefined,
          children: inlineRuns(clean, { bold: header }),
          spacing: { after: 60 },
        });
      });
  }

  function renderSection(title: string, content: string | undefined): InstanceType<typeof Paragraph>[] {
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
