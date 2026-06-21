import { createCompletion, createCompletionFromSession, parseJsonResponse, SessionCredentials } from './aiProvider';
import { CVSections } from '../routes/cv';
import { OptimizeResult, SectionDiff } from './cvOptimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModifyConfig {
  maxPages?: number;
  tone?: 'professional' | 'conversational' | 'executive';
}

const DEFAULT_CONFIG: Required<ModifyConfig> = {
  maxPages: 2,
  tone: 'professional',
};

// Section keys we let the AI rewrite (everything in CVSections except contact/raw).
const EDITABLE_KEYS: Array<keyof CVSections> = [
  'summary',
  'experience',
  'education',
  'skills',
  'certifications',
  'projects',
  'languages',
  'awards',
  'publications',
  'volunteer',
  'other',
];

// Meta keys the AI returns alongside the sections.
const META_KEYS = new Set(['changes', 'removed', 'needsMoreInfo']);

// ---------------------------------------------------------------------------
// System prompt — CV editor that folds the user's new data into the CV
// ---------------------------------------------------------------------------
const MODIFY_SYSTEM_PROMPT = `You are an elite CV/resume editor. The candidate gives you their CURRENT CV (split into sections) plus a block of NEW DATA — free-form notes about a new role, fresh achievements/metrics, projects to add, or things to drop. Your job is to fold that new data into the right sections, applying CV best practice, and return the updated CV.

## WHAT TO DO
1. **Route the data to the right sections.** Inspect every section. Only change a section if the NEW DATA actually affects it. Leave untouched sections exactly as they are (you may omit them from the output, or return them unchanged).
2. **Experience & Projects — rewrite to best practice.** Lead each bullet with a strong past-tense action verb (Built, Led, Shipped, Reduced…); the current role may use present tense. One idea per bullet, 1–2 lines, quantified impact where the candidate gave a number. Order entries reverse-chronologically (most recent first; "Present" before past dates).
3. **Add new entries from the data — MIRROR the existing structure.** A new role/project MUST follow the EXACT same layout as the other entries already in that section: the same header format, the same labelled lines, in the same order, with the same bullet style. Study an existing entry first. If existing entries have lines like "Role:", "Team Size:", several achievement bullets, then "Link product:", "Frontend:", "Backend:" — the new entry MUST include those same labelled lines in the same order. Fill each from the NEW DATA; where a field's value is missing, OMIT that single line (do not invent it) and add a needsMoreInfo question for it — but keep every other entry's structure parallel. Do NOT produce a thin entry with one bullet next to a rich multi-bullet entry.
3b. **TIMELINE ORDER (strict).** After adding/editing, re-sort ALL entries in Experience and Projects by their date range, MOST RECENT FIRST. An ongoing entry ("Present"/no end date) comes before any entry with a past end date. Compare end dates first, then start dates. Example: an entry dated "03/2026 - Present" must appear ABOVE one dated "07/2023 - 03/2026". Never leave a newer entry below an older one.
4. **Recommend removals to fit ${'${maxPages}'} pages.** If the CV would exceed the page budget, identify the WEAKEST or most OUTDATED projects/bullets to drop — and either remove them from the section output OR list them. ALWAYS report what you removed in "removed" so the user can confirm; never silently delete a whole role/employer.
5. **Flag thin data.** Where the notes are ambiguous or too sparse to write a strong bullet (e.g. "worked on the API" with no impact), DON'T invent details — instead add an entry to "needsMoreInfo" asking the user for the specific missing fact (a metric, a date, the tech used).

## INVIOLABLE RULES
- **NO HALLUCINATION.** Only use facts present in the CURRENT CV or in the NEW DATA. Never invent companies, job titles, dates, degrees, certifications, or numeric metrics. If a metric is not given, omit it (and optionally ask for it via needsMoreInfo).
- **PRESERVE FACTUAL ACCURACY.** Keep all existing dates, employer names, job titles, and institution names exactly as written, unless the NEW DATA explicitly corrects them.
- **PRESERVE ALL LINKS** (URL, email, LinkedIn/GitHub/portfolio) byte-for-byte, in their original location.
- **2-PAGE DISCIPLINE.** Be concise. Prefer cutting weak content over padding. Target up to ${'${maxPages}'} page(s).
- **NO KEYWORD STUFFING, NO AI-TELL PHRASES** ("results-driven", "proven track record", "passionate about", "leverage synergies", "spearhead").

## SECTIONS FORMATTING
- For SKILLS, put each category on its own line ("Category: a, b, c") separated by line breaks.
- For EXPERIENCE/PROJECTS, keep each entry's header line (company/role/project + date range) on its own line, immediately followed by that entry's bullets. Use real line breaks (\\n).

## OUTPUT FORMAT
Return ONE JSON object. No markdown fences, no commentary. Keys:
- One key per section you CHANGED (lowercase: summary, experience, projects, skills, …), value = the full rewritten section as a plain string. Omit sections you did not change.
- **REMOVAL MUST BE APPLIED, not just reported.** When you drop an entry, you MUST return that section's key with the FULL updated text (the remaining entries, with the dropped one gone). If dropping leaves the section empty, return that key as an empty string "". NEVER list something in "removed" without also returning the updated section content that reflects the removal.
- "changes": string[] — short human-readable summary of each edit you made ("Added Senior Engineer role at Acme (2025–Present)", "Rewrote 3 project bullets with metrics").
- "removed": string[] — anything you dropped or recommend dropping ("Removed outdated jQuery dashboard project").
- "needsMoreInfo": array of { "section": string, "question": string } — specific follow-up questions where the data was too thin to write a strong bullet.

If nothing needs removing, return "removed": []. If no questions, return "needsMoreInfo": [].`;

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------
function _buildModifyPrompt(
  cvSections: CVSections,
  userData: string,
  config: Required<ModifyConfig>
): string {
  const toneInstruction =
    config.tone === 'executive'
      ? 'Tone: authoritative and strategic. Emphasise leadership, vision, and business impact.'
      : config.tone === 'conversational'
      ? 'Tone: warm and approachable, but still professional.'
      : 'Tone: polished professional. Clear, confident, and results-focused.';

  const sectionKeys = (Object.keys(cvSections) as Array<keyof CVSections>).filter(
    (k) => !['contact', 'raw'].includes(k as string) && cvSections[k] && String(cvSections[k]).trim().length > 0
  );

  const sectionsBlock = sectionKeys
    .map((k) => `### ${String(k).toUpperCase()}\n${cvSections[k]}`)
    .join('\n\n');

  return `## TASK
Update the CV below by folding in the candidate's NEW DATA. Decide which sections the data affects and change only those. Keep everything within ${config.maxPages} page(s).

## CONSTRAINTS
- ${toneInstruction}
- NEVER invent core facts: companies, job titles, dates, degrees, or numeric metrics not present in the CV or the NEW DATA.
- Preserve every existing date, employer name, job title, and institution name exactly.
- Preserve EVERY link byte-for-byte, in its original location.

## CURRENT CV SECTIONS
${sectionsBlock || '(no sections detected)'}

## NEW DATA (from the candidate)
${userData}

## INSTRUCTIONS
Fold the NEW DATA into the relevant sections, applying CV best practice (strong action verbs, one idea per bullet, quantified impact only where a number was given). Recommend dropping the weakest/oldest content to stay within ${config.maxPages} page(s) and report it in "removed". Where the data is too thin to write a strong bullet, ask for the missing fact via "needsMoreInfo" instead of inventing it.

CRITICAL for EXPERIENCE and PROJECTS:
1. Every entry in a section MUST share the SAME structure. Before adding a new entry, copy the labelled-line layout of an existing entry in that section (e.g. "Role:", "Team Size:", achievement bullets, "Link product:", "Frontend:", "Backend:") and reproduce those same lines, in the same order, for the new entry. Never output a one-bullet entry beside a rich multi-bullet one. Omit (don't fabricate) any line whose value you don't have, and raise it in needsMoreInfo.
2. Re-sort ALL entries by date, MOST RECENT FIRST. Ongoing ("Present") entries go on top; an entry ending "Present" outranks one ending in a past date. e.g. "03/2026 - Present" must sit ABOVE "07/2023 - 03/2026".

Return ONLY the JSON object described in the system prompt — changed sections plus "changes", "removed", and "needsMoreInfo". No markdown fences. No commentary.`;
}

// ---------------------------------------------------------------------------
// Deterministic timeline ordering for entry-based sections (experience/projects)
//
// LLMs are unreliable at reverse-chronological sorting, so we enforce it in
// code. Conservative: if we cannot confidently parse every entry's dates, we
// return the text unchanged rather than risk mangling it.
// ---------------------------------------------------------------------------
const DATE_RANGE_RE =
  /(\d{1,2}\/\d{4}|\b(?:19|20)\d{2}\b)\s*[-–—to]+\s*(present|current|now|ongoing|\d{1,2}\/\d{4}|\b(?:19|20)\d{2}\b)/i;
// Lines that are entry sub-fields, never headers, even if they mention a year.
const NON_HEADER_RE = /^\s*([•\-*‣◦·]|role:|team size:|link|frontend:|backend:|tech:|stack:|tools:)/i;

/**
 * Drop dangling "Label:" lines that have no value — the AI sometimes mirrors
 * an existing entry's structure (Link product:/Backend:/…) but leaves the line
 * empty when the user gave no value. An empty labelled line reads as unfinished.
 */
function _stripEmptyLabelLines(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((ln) => !/^\s*[A-Za-z][A-Za-z /&]*:\s*$/.test(ln))
    .join('\n');
}

/** Convert a date token to a sortable month-count; `Present` → Infinity. */
function _parseDateToken(tok: string): number | null {
  const t = tok.trim().toLowerCase();
  if (/present|current|now|ongoing/.test(t)) return Number.POSITIVE_INFINITY;
  let m = t.match(/(\d{1,2})\/(\d{4})/);
  if (m) return parseInt(m[2], 10) * 12 + parseInt(m[1], 10);
  m = t.match(/((?:19|20)\d{2})/);
  if (m) return parseInt(m[1], 10) * 12 + 6; // year-only → mid-year
  return null;
}

interface _Entry {
  header: string;
  body: string[];
  start: number;
  end: number;
}

function _reorderEntriesByTimeline(text: string): string {
  if (!text || !text.trim()) return text;
  const lines = text.split('\n');

  const isHeader = (ln: string) => DATE_RANGE_RE.test(ln) && !NON_HEADER_RE.test(ln);

  const pre: string[] = [];
  const entries: _Entry[] = [];
  let cur: _Entry | null = null;

  for (const ln of lines) {
    if (isHeader(ln)) {
      if (cur) entries.push(cur);
      cur = { header: ln, body: [], start: 0, end: 0 };
    } else if (cur) {
      cur.body.push(ln);
    } else {
      pre.push(ln);
    }
  }
  if (cur) entries.push(cur);

  if (entries.length < 2) return text; // nothing to sort

  // Parse dates; bail out entirely if any entry can't be parsed.
  for (const e of entries) {
    const m = e.header.match(DATE_RANGE_RE);
    if (!m) return text;
    const start = _parseDateToken(m[1]);
    const end = _parseDateToken(m[2]);
    if (start === null || end === null) return text;
    e.start = start;
    e.end = end;
  }

  // Trim trailing blank lines from each entry's body for clean re-joining.
  for (const e of entries) {
    while (e.body.length && e.body[e.body.length - 1].trim() === '') e.body.pop();
  }

  const cmp = (a: _Entry, b: _Entry): number => {
    if (a.end !== b.end) {
      if (a.end === Number.POSITIVE_INFINITY) return -1;
      if (b.end === Number.POSITIVE_INFINITY) return 1;
      return b.end - a.end;
    }
    return b.start - a.start;
  };

  const sorted = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => cmp(a.e, b.e) || a.i - b.i) // stable
    .map((x) => x.e);

  if (sorted.every((e, i) => e === entries[i])) return text; // already ordered

  const preStr = pre.join('\n').replace(/\s+$/, '');
  const body = sorted.map((e) => [e.header, ...e.body].join('\n')).join('\n\n');
  return preStr ? `${preStr}\n${body}` : body;
}

// ---------------------------------------------------------------------------
// Diff utility — same shape as cvOptimizer's diff
// ---------------------------------------------------------------------------
function _buildDiff(original: CVSections, modified: CVSections): Record<string, SectionDiff> {
  const diff: Record<string, SectionDiff> = {};
  for (const key of Object.keys(modified) as Array<keyof CVSections>) {
    const orig = String(original[key] || '').trim();
    const mod = String(modified[key] || '').trim();
    diff[key as string] = {
      changed: orig !== mod,
      lengthDelta: mod.length - orig.length,
      originalLength: orig.length,
      newLength: mod.length,
    };
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Modify CV sections from the user's free-text data (new role, achievements,
 * projects to add/drop). Returns the same result shape as `optimize` so the
 * existing diff editor / export pipeline can consume it — minus an ATS score
 * (there is no job description), plus `changes` / `removed` / `needsMoreInfo`.
 */
export async function modify(
  cvSections: CVSections,
  userData: string,
  config: Record<string, unknown> = {},
  session?: { credentials?: SessionCredentials }
): Promise<OptimizeResult> {
  const mergedConfig: Required<ModifyConfig> = { ...DEFAULT_CONFIG, ...config } as Required<ModifyConfig>;

  const systemPrompt = MODIFY_SYSTEM_PROMPT.replace(/\$\{maxPages\}/g, String(mergedConfig.maxPages));
  const userPrompt = _buildModifyPrompt(cvSections, userData, mergedConfig);

  const completionMessages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];
  const completionOptions = { maxTokens: 6000, temperature: 0.3 };

  const result = session
    ? await createCompletionFromSession(session, completionMessages, completionOptions)
    : await createCompletion(completionMessages, completionOptions);

  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonResponse(result.content) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`AI returned unparseable response during CV modification: ${(err as Error).message}`);
  }

  // Pull out the meta keys, keep everything else as candidate section content.
  const changes = _toStringArray(parsed.changes);
  const removed = _toStringArray(parsed.removed);
  const needsMoreInfo = _toNeedsMoreInfo(parsed.needsMoreInfo);

  // Start from the original sections, then overwrite the editable section keys
  // the AI explicitly returned. An explicit empty string clears a section (a
  // removal that emptied it); an ABSENT key leaves the original untouched.
  const modifiedSections: CVSections = { ...cvSections };
  for (const key of EDITABLE_KEYS) {
    if (key in parsed && typeof parsed[key] === 'string') {
      (modifiedSections as unknown as Record<string, unknown>)[key as string] = parsed[key];
    }
  }

  // Enforce reverse-chronological ordering deterministically (LLMs are
  // unreliable at this). No-ops if the dates can't be parsed confidently.
  for (const key of ['experience', 'projects'] as Array<keyof CVSections>) {
    const v = modifiedSections[key];
    if (typeof v === 'string' && v.trim()) {
      (modifiedSections as unknown as Record<string, unknown>)[key as string] =
        _reorderEntriesByTimeline(_stripEmptyLabelLines(v));
    }
  }

  // Preserve contact and raw exactly.
  modifiedSections.contact = cvSections.contact;
  modifiedSections.raw = cvSections.raw;

  const diff = _buildDiff(cvSections, modifiedSections);

  return {
    originalSections: cvSections,
    optimizedSections: modifiedSections,
    diff,
    config: { maxPages: mergedConfig.maxPages, tone: mergedConfig.tone } as unknown as OptimizeResult['config'],
    kind: 'modify',
    changes,
    removed,
    needsMoreInfo,
    userData,
  };
}

// ---------------------------------------------------------------------------
// Helpers — defensively coerce the AI's meta fields
// ---------------------------------------------------------------------------
function _toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function _toNeedsMoreInfo(value: unknown): Array<{ section: string; question: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (v && typeof v === 'object') {
        const section = String((v as Record<string, unknown>).section ?? '');
        const question = String((v as Record<string, unknown>).question ?? '');
        if (question.trim()) return { section, question };
      }
      if (typeof v === 'string' && v.trim()) return { section: '', question: v };
      return null;
    })
    .filter((v): v is { section: string; question: string } => v !== null);
}

export { DEFAULT_CONFIG };
