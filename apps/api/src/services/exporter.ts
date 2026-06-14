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
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// HTML template helpers
// ---------------------------------------------------------------------------

function _escapeHtml(str: string | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert newline-separated bullet text into <li> items.
 * Lines starting with - or • are treated as bullets.
 */
function _renderBullets(text: string | undefined): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items = lines.map((l) => {
    const clean = l.replace(/^[-•*]\s*/, '');
    return `<li>${_escapeHtml(clean)}</li>`;
  });
  return items.length > 0 ? `<ul>${items.join('')}</ul>` : '';
}

function _renderSection(title: string, content: string | undefined, asBullets = false): string {
  if (!content || !String(content).trim()) return '';
  const body = asBullets
    ? _renderBullets(content)
    : `<p>${_escapeHtml(content).replace(/\r?\n/g, '<br/>')}</p>`;
  return `
    <section>
      <h2>${_escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function _buildHtml(sections: CVSections, meta: { name?: string } = {}): string {
  const contact = (sections.contact || {}) as ContactInfo;
  const name = _escapeHtml(contact.name || meta.name || 'Candidate');
  const email = _escapeHtml(contact.email || '');
  const phone = _escapeHtml(contact.phone || '');
  const linkedin = _escapeHtml(contact.linkedin || '');
  const location = _escapeHtml(contact.location || '');

  const contactLine = [email, phone, linkedin, location].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', 'Times New Roman', serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; padding: 36px 48px; max-width: 860px; margin: auto; }
  h1 { font-size: 22pt; font-weight: bold; text-align: center; margin-bottom: 4px; letter-spacing: 0.5px; }
  .contact { text-align: center; font-size: 9pt; color: #444; margin-bottom: 18px; }
  section { margin-bottom: 16px; page-break-inside: avoid; }
  h2 { font-size: 11pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1.2px; border-bottom: 1.5px solid #1a1a1a; padding-bottom: 3px; margin-bottom: 6px; }
  p { margin-bottom: 6px; }
  ul { margin: 0 0 6px 18px; }
  li { margin-bottom: 3px; }
  @page { margin: 18mm 15mm; }
</style>
</head>
<body>
  <h1>${name}</h1>
  ${contactLine ? `<p class="contact">${contactLine}</p>` : ''}
  ${_renderSection('Professional Summary', sections.summary)}
  ${_renderSection('Experience', sections.experience, true)}
  ${_renderSection('Education', sections.education, true)}
  ${_renderSection('Skills', sections.skills, true)}
  ${sections.certifications ? _renderSection('Certifications', sections.certifications, true) : ''}
  ${sections.projects ? _renderSection('Projects', sections.projects, true) : ''}
  ${sections.languages ? _renderSection('Languages', sections.languages, true) : ''}
  ${sections.awards ? _renderSection('Awards & Honours', sections.awards, true) : ''}
  ${sections.publications ? _renderSection('Publications', sections.publications, true) : ''}
  ${sections.volunteer ? _renderSection('Volunteer Experience', sections.volunteer, true) : ''}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// PDF export
// ---------------------------------------------------------------------------

/**
 * Export sections to PDF.
 *
 * Tries puppeteer first. If puppeteer is unavailable, falls back to
 * returning the rendered HTML string (Buffer of UTF-8 bytes) so the
 * caller can still serve it with Content-Type: text/html.
 */
export async function exportToPDF(sections: CVSections, meta: { name?: string } = {}): Promise<ExportResult> {
  const html = _buildHtml(sections, meta);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const puppeteer = require('puppeteer') as any;
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
    await browser.close();
    return { buffer: Buffer.from(pdfBuffer), mimeType: 'application/pdf', extension: 'pdf' };
  } catch {
    // Puppeteer not installed — return HTML as fallback
    console.warn('[exporter] puppeteer not available, returning HTML instead of PDF.');
    return {
      buffer: Buffer.from(html, 'utf8'),
      mimeType: 'text/html',
      extension: 'html',
    };
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
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: name, bold: true, size: 40, font: 'Calibri' })],
        spacing: { after: 60 },
      }),
    ];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function contactBlock(): any[] {
    const parts = [contact.email, contact.phone, contact.linkedin, contact.location]
      .filter(Boolean)
      .join('   |   ');
    if (!parts) return [];
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: parts, size: 18, color: '555555', font: 'Calibri' })],
        spacing: { after: 200 },
      }),
    ];
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
          font: 'Calibri',
          underline: { type: UnderlineType.SINGLE },
        }),
      ],
      border: {
        bottom: { color: '000000', space: 1, value: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { before: 200, after: 80 },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textToParagraphs(text: string | undefined): any[] {
    if (!text) return [];
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const isBullet = /^[-•*]/.test(line);
        const clean = line.replace(/^[-•*]\s*/, '');
        return new Paragraph({
          bullet: isBullet ? { level: 0 } : undefined,
          children: [new TextRun({ text: clean, size: 20, font: 'Calibri' })],
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
