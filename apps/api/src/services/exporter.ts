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
];

/** Draw a section heading with an underline rule, then its content. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _renderPdfSection(doc: any, title: string, content: string | undefined, asBullets: boolean): void {
  if (!content || !String(content).trim()) return;

  doc.moveDown(0.7);
  doc.font('Times-Bold').fontSize(11).fillColor('#1a1a1a').text(title.toUpperCase(), { characterSpacing: 0.8 });
  const ruleY = doc.y + 2;
  doc
    .moveTo(doc.page.margins.left, ruleY)
    .lineTo(doc.page.width - doc.page.margins.right, ruleY)
    .lineWidth(1)
    .strokeColor('#1a1a1a')
    .stroke();
  doc.moveDown(0.5);

  doc.font('Times-Roman').fontSize(11).fillColor('#1a1a1a');
  if (asBullets) {
    content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const clean = line.replace(/^[-•*]\s*/, '');
        doc.text(`•  ${clean}`, { indent: 8, paragraphGap: 3, lineGap: 1 });
      });
  } else {
    doc.text(content, { paragraphGap: 4, lineGap: 1 });
  }
}

/**
 * Export sections to a real PDF buffer using pdfkit.
 */
export async function exportToPDF(sections: CVSections, meta: { name?: string } = {}): Promise<ExportResult> {
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
  doc.font('Times-Bold').fontSize(22).fillColor('#1a1a1a').text(name, { align: 'center' });

  const contactLine = [contact.email, contact.phone, contact.linkedin, contact.location]
    .filter(Boolean)
    .join('   |   ');
  if (contactLine) {
    doc.font('Times-Roman').fontSize(9).fillColor('#444').text(contactLine, { align: 'center' });
  }

  for (const s of PDF_SECTIONS) {
    _renderPdfSection(doc, s.title, sections[s.key] as string | undefined, s.bullets);
  }

  doc.end();
  const buffer = await finished;
  return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
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
