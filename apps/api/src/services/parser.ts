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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text;
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
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  raw: string;
}

/**
 * Attempt to extract the candidate's name and contact info from the first few lines.
 */
function _extractContact(lines: string[]): ContactInfo {
  const contact: ContactInfo = { name: '', email: '', phone: '', location: '', linkedin: '', raw: '' };
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

    // LinkedIn
    if (/linkedin\.com/i.test(line) && !contact.linkedin) {
      const liMatch = line.match(/linkedin\.com\/in\/[\w-]+/i);
      if (liMatch) contact.linkedin = `https://${liMatch[0]}`;
    }

    contactLines.push(line);
  }

  // First non-blank line is usually the name
  if (lines[0]) contact.name = lines[0].trim();
  contact.raw = contactLines.join('\n');
  return contact;
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
  const buffer: Record<string, string[]> = {};

  for (const line of lines) {
    const sectionKey = _identifySection(line) || (_looksLikeHeading(line) ? '__heading__' : null);

    if (sectionKey && sectionKey !== '__heading__') {
      currentSection = sectionKey;
      if (!buffer[currentSection]) buffer[currentSection] = [];
      continue; // Don't include the heading itself in the content
    }

    if (sectionKey === '__heading__') {
      // Unknown heading - close current section, start "other" accumulation
      // Only switch if not already in a known section
      if (!currentSection) {
        currentSection = 'other';
        if (!buffer[currentSection]) buffer[currentSection] = [];
      }
      continue;
    }

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
