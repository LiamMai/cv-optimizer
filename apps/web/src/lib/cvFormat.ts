// Structured CV formatting for the editor — mirrors the PDF export template
// (apps/api/src/services/exporter.ts) so the on-screen "paper" matches the
// downloaded PDF: ruled section headers, justified summary, bulleted lists,
// and entry rows with a bold title + right-aligned date range.

export type InlineRun = { text: string; href?: string };

export type CvBlock =
  | { kind: 'paragraph'; runs: InlineRun[] }
  | { kind: 'entry'; titleRuns: InlineRun[]; date?: string }
  | { kind: 'bullet'; label?: string; runs: InlineRun[] };

export type SectionKind = 'paragraph' | 'list' | 'entries';

// Which layout each section type uses — matches HTML_SECTIONS in the exporter.
const SECTION_KIND: Record<string, SectionKind> = {
  summary: 'paragraph',
  skills: 'list',
  experience: 'entries',
  projects: 'entries',
  education: 'list',
  certifications: 'list',
  languages: 'list',
  awards: 'list',
  publications: 'list',
  volunteer: 'entries',
  other: 'list',
};

export function sectionKind(type: string): SectionKind {
  return SECTION_KIND[type] ?? 'list';
}

const DATE_RANGE = /\s*((?:\d{1,2}\/\d{4}|\w+\s+\d{4})\s*[-–]\s*(?:\d{1,2}\/\d{4}|\w+\s+\d{4}|present|current|now))\s*$/i;
const INLINE_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<]+)/g;

/** Split text into runs, turning markdown links and bare URLs into linked runs. */
export function parseInline(s: string): InlineRun[] {
  const src = String(s);
  const runs: InlineRun[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK.lastIndex = 0;
  while ((m = INLINE_LINK.exec(src)) !== null) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    if (m[1]) {
      runs.push({ text: m[1], href: m[2] });
    } else {
      const url = m[3].replace(/[.,;:]+$/, '');
      runs.push({ text: url, href: url });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs.length ? runs : [{ text: src }];
}

/** Rejoin wrap-continuation lines (lowercase / bracket start, or prev ended mid-list). */
function coalesceLines(content: string): string[] {
  const raw = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of raw) {
    const clean = line.replace(/^[-•*]\s*/, '');
    const prev = out.length ? out[out.length - 1] : '';
    const isContinuation =
      out.length > 0 &&
      !isEntryHeader(line) &&
      (/^[a-z(,)]/.test(clean) || /,$/.test(prev.trim()));
    if (isContinuation) out[out.length - 1] = `${out[out.length - 1]} ${clean}`;
    else out.push(line);
  }
  return out;
}

/** A line naming a role/company/date range — rendered as a bold entry header. */
function isEntryHeader(line: string): boolean {
  const t = line.replace(/^[-•*]\s*/, '').trim();
  if (!t) return false;
  if (/\b(\d{1,2}\/\d{4}|present)\b/i.test(t)) return true;
  if (/\s\/\s/.test(t) && t.length < 80) return true;
  return false;
}

/** Split a run-on "Cat A: …. Cat B: …" blob into one item per category. */
function splitCategoryRun(line: string): string[] {
  const marked = line.replace(
    /([.;])\s+(?=[A-Z][A-Za-z0-9.+#]*(?:[ &/]+[A-Z][A-Za-z0-9.+#]*){0,3}:\s)/g,
    (_m, punct) => `${punct}\n`
  );
  const parts = marked.split('\n').map((p) => p.trim().replace(/^[.;,\s]+/, '')).filter(Boolean);
  const labelled = parts.filter((p) => /^[A-Z][A-Za-z0-9 .+#&/]{0,38}:\s/.test(p));
  return labelled.length >= 2 ? parts : [line];
}

function formatParagraph(content: string): CvBlock[] {
  const para = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
  return [{ kind: 'paragraph', runs: parseInline(para) }];
}

function formatList(content: string): CvBlock[] {
  return coalesceLines(content)
    .flatMap((line) => splitCategoryRun(line.replace(/^[-•*]\s*/, '').trim()))
    .map((clean): CvBlock => {
      const m = clean.match(/^([A-Z][A-Za-z &/]{0,30}):\s*(.*)$/);
      if (m) return { kind: 'bullet', label: m[1], runs: parseInline(m[2]) };
      return { kind: 'bullet', runs: parseInline(clean) };
    });
}

function formatEntries(content: string): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const line of coalesceLines(content)) {
    const clean = line.replace(/^[-•*]\s*/, '').trim();
    const isLabel = /^[A-Z][A-Za-z &/]{0,28}:/.test(clean);
    if (isEntryHeader(line) && !isLabel) {
      const m = clean.match(DATE_RANGE);
      if (m) {
        blocks.push({ kind: 'entry', titleRuns: parseInline(clean.slice(0, m.index).trim()), date: m[1] });
      } else {
        blocks.push({ kind: 'entry', titleRuns: parseInline(clean) });
      }
    } else if (isLabel) {
      const idx = clean.indexOf(':');
      blocks.push({ kind: 'bullet', label: clean.slice(0, idx), runs: parseInline(clean.slice(idx + 1)) });
    } else {
      blocks.push({ kind: 'bullet', runs: parseInline(clean) });
    }
  }
  return blocks;
}

/** Plain text of an inline run sequence. */
export function runsToText(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('');
}

/** Markdown text of a run sequence (round-trips links as [text](url)). */
function runsToMarkdown(runs: InlineRun[]): string {
  return runs
    .map((r) => (r.href && r.href !== r.text ? `[${r.text}](${r.href})` : r.text))
    .join('');
}

/** Plain text of a block — used for word-diffing. */
export function blockText(b: CvBlock): string {
  if (b.kind === 'paragraph') return runsToText(b.runs);
  if (b.kind === 'entry') return [runsToText(b.titleRuns), b.date].filter(Boolean).join(' ');
  return [b.label, runsToText(b.runs)].filter(Boolean).join(': ');
}

/** Serialize one block back to a source line the export formatter understands. */
export function blockToLine(b: CvBlock): string {
  if (b.kind === 'paragraph') return runsToMarkdown(b.runs);
  if (b.kind === 'entry') return [runsToMarkdown(b.titleRuns), b.date].filter(Boolean).join('  ');
  const body = runsToMarkdown(b.runs);
  return `- ${b.label ? `${b.label}: ${body}` : body}`;
}

/** Rebuild a section's content string from a list of blocks. */
export function blocksToContent(blocks: CvBlock[]): string {
  return blocks.map(blockToLine).join('\n');
}

/** Parse a section's raw content into structured blocks for the chosen layout. */
export function formatSection(type: string, content: string): CvBlock[] {
  if (!content || !content.trim()) return [];
  const kind = sectionKind(type);
  if (kind === 'paragraph') return formatParagraph(content);
  if (kind === 'entries') return formatEntries(content);
  return formatList(content);
}
