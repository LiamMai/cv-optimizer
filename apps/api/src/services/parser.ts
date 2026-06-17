import { promises as fs } from 'fs';
import { CVSections } from '../routes/cv';

/**
 * Parse a file (PDF, DOCX, TXT) and return its raw text content.
 */
export async function parseFile(filePath: string, mimetype: string): Promise<string> {
  switch (mimetype) {
    case 'application/pdf':
      return _parsePDF(filePath);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return _parseDOCX(filePath);
    case 'text/plain':
      return _parseTXT(filePath);
    default:
      throw new Error(`Unsupported MIME type: ${mimetype}`);
  }
}

async function _parsePDF(filePath: string): Promise<string> {
  // Prefer pdfjs-dist: it preserves visual reading order (so the candidate's name
  // lands on its own line) and is far more robust than pdf-parse on real-world PDFs.
  try {
    return await _parsePdfWithPdfjs(filePath);
  } catch {
    // Fallback to pdf-parse if pdfjs can't open the document.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);
    return result.text;
  }
}

/**
 * Extract text from a PDF using pdfjs-dist, reconstructing visual lines by grouping
 * text items on the same vertical band and ordering them top-to-bottom, left-to-right.
 */
async function _parsePdfWithPdfjs(filePath: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;

  const pageTexts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str: string; transform: number[] }>).filter(
      (it) => typeof it.str === 'string'
    );

    // Group items into lines keyed by rounded Y (PDF origin is bottom-left, so larger Y = higher).
    const lineMap = new Map<number, Array<{ x: number; str: string }>>();
    for (const it of items) {
      const x = it.transform[4];
      const y = Math.round(it.transform[5]);
      // Snap near-equal Y values together (±2pt) to the same line bucket.
      let key = y;
      for (const existing of lineMap.keys()) {
        if (Math.abs(existing - y) <= 2) { key = existing; break; }
      }
      if (!lineMap.has(key)) lineMap.set(key, []);
      lineMap.get(key)!.push({ x, str: it.str });
    }

    const lines = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0]) // top to bottom
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((pt) => pt.str)
          .join('')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);

    pageTexts.push(lines.join('\n'));
  }

  await doc.destroy();
  return pageTexts.join('\n\n');
}

async function _parseDOCX(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require('mammoth') as {
    extractRawText: (options: { path: string }) => Promise<{ value: string }>;
  };
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function _parseTXT(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath, 'utf8');
  return buffer;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

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
    const line = lines[i].trim();
    if (!line) continue;

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

    // Name — first line in the header block that looks like a person's name.
    if (!contact.name && _looksLikeName(line)) contact.name = line;
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
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
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
  _mergeLinks(sections.contact as unknown as ContactInfo, urls);
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
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
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
  sections.contact = _extractContact(lines) as unknown as Record<string, string>;

  let currentSection: string | null = null;
  let seenKnown = false; // have we passed the contact header into a real section yet?
  const buffer: Record<string, string[]> = {};

  for (const line of lines) {
    const sectionKey = _identifySection(line) || (_looksLikeHeading(line) ? '__heading__' : null);

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
