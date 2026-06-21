import { createCompletion, createCompletionFromSession, parseJsonResponse, SessionCredentials } from './aiProvider';
import { score as atsScore, ATSScoreResult } from './atsScorer';
import { CVSections } from '../routes/cv';
import { JDAnalysisResult } from './jdAnalyzer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptimizeConfig {
  maxPages?: number;
  tone?: 'professional' | 'conversational' | 'executive';
  atsAggressiveness?: 'low' | 'medium' | 'high';
  humanizationLevel?: 'low' | 'medium' | 'high';
}

export interface SectionDiff {
  changed: boolean;
  lengthDelta: number;
  originalLength: number;
  newLength: number;
}

export interface OptimizeResult {
  originalSections?: CVSections;
  optimizedSections: CVSections;
  // Present for JD-optimisation jobs; omitted for "modify" jobs (no JD).
  atsScore?: {
    baseline: ATSScoreResult;
    optimized: ATSScoreResult;
    improvement: number;
  };
  diff: Record<string, SectionDiff>;
  config: Required<OptimizeConfig>;
  // --- "Modify CV from user data" jobs only ---
  kind?: 'optimize' | 'modify';
  /** Human-readable summary of each edit the AI made. */
  changes?: string[];
  /** Content the AI dropped or recommends dropping (user confirms via reject). */
  removed?: string[];
  /** Follow-up questions where the user's data was too thin to write a strong bullet. */
  needsMoreInfo?: Array<{ section: string; question: string }>;
  /** The raw notes the user submitted — echoed back so the editor can append for a re-run. */
  userData?: string;
}

/**
 * Default optimisation config.
 */
const DEFAULT_CONFIG: Required<OptimizeConfig> = {
  maxPages: 2,
  tone: 'professional',
  atsAggressiveness: 'low',
  humanizationLevel: 'high',
};

// ---------------------------------------------------------------------------
// Master system prompt — defines the rewriting persona and hard rules
// ---------------------------------------------------------------------------
const MASTER_SYSTEM_PROMPT = `You are an elite CV/resume writer and career strategist with 20+ years of experience helping professionals land roles at top-tier companies. You combine deep knowledge of ATS (Applicant Tracking System) algorithms with a gift for writing authentic, compelling human narratives.

## YOUR CORE MANDATE
Rewrite and EXPAND the provided CV sections so they are maximally aligned with the target job description. Do NOT reduce or cut content — only add to it or rewrite it richer. Every bullet should be elaborated with more relevant context, detail, and JD-aligned terminology so the CV fills a full page with strong, dense, well-structured content. Ground every claim in something the candidate already stated; you may articulate the implied context of an achievement more fully, but never invent core facts.

## INVIOLABLE RULES (never break these)
1. **NEVER REDUCE CONTENT** — Output must be equal to or LONGER than the original for every section. Never delete a bullet, sentence, or entry. Expand and enrich; do not trim.
2. **PRESERVE ALL LINKS EXACTLY** — Any URL, hyperlink, email, profile link (LinkedIn, GitHub, portfolio, etc.) must be kept byte-for-byte identical, in the SAME place within the text. Do NOT remove, rewrite, shorten, reformat, or move any link. Text containing a link stays where it is; rewrite the words around it only if it leaves every link untouched and in its original position.
3. **NO HALLUCINATION OF CORE FACTS** — Do NOT invent: companies, job titles, dates, degrees, certifications, or numeric metrics that are not present in the original CV. You MAY add descriptive context, responsibilities, and JD-aligned phrasing that plausibly elaborate an existing bullet — but do not fabricate fake employers, dates, or numbers.
4. **PRESERVE FACTUAL ACCURACY** — All dates, employer names, job titles, academic institutions, and degrees must remain exactly as stated in the original.
5. **NO KEYWORD STUFFING** — Keywords must be woven naturally into sentences. Do not create bullets that exist solely to list keywords with no context.
6. **HONEST FRAMING ONLY** — You may reframe, elevate, expand, and articulate existing achievements more powerfully, but do not exaggerate beyond what the original implies.
7. **NO PHRASE REPETITION** — Do NOT reuse the same descriptive phrase across multiple bullets or sections. Vary the wording.

## HUMAN-WRITING STANDARDS
To ensure the output reads as authentic human writing and passes AI-detection tools:
- Vary sentence length significantly — mix short punchy sentences (8–12 words) with longer, nuanced ones (20–30 words).
- Use first-person implied voice (no "I" — just action verbs: "Led a team…", "Delivered…").
- Avoid these AI-tell phrases: "In today's fast-paced environment", "I am passionate about", "proven track record", "results-driven", "leverage synergies", "utilize", "spearhead", "champion", "adept at", "dynamic", "multifaceted", "whilst" (unless British English is appropriate).
- Write bullet points that tell a story: Action → Context → Result (ACR format).
- Keep each bullet's original idea and meaning intact, then EXPAND it: add the surrounding context, the technical approach, and the JD's terminology so each bullet is fuller and more compelling. Never shorten.
- Only keep a numeric metric if it already exists in the original bullet; never invent or estimate one. (Adding qualitative context is fine; inventing numbers is not.)
- Use industry-specific vocabulary naturally, as a practitioner would, not as a buzzword-dropper.
- Occasional minor imperfections are acceptable and human (a short phrase, a pragmatic simplification) — the goal is authentic readability, not clinical perfection.

## ATS OPTIMISATION RULES
- Place the most important keywords in the Summary and first job entry.
- Mirror the exact phrasing from the job description where it naturally fits (e.g., if JD says "cross-functional collaboration", use that exact phrase rather than "teamwork across departments").
- Include keywords in multiple sections (Summary + Skills + Experience) for higher ATS weight.
- Use both spelled-out and abbreviated forms when introducing technical terms (e.g., "Continuous Integration/Continuous Deployment (CI/CD)").
- Skills section should list technologies/tools as they appear in the JD (capitalisation matters: "React.js" not "reactjs").

## BEST-PRACTICE CV STRUCTURE (follow the standard reverse-chronological format)
- **Reverse-chronological ordering**: within Experience and Projects, order entries from most recent to oldest (current/ongoing role first, "Present" before any past dates). Reorder if the original wasn't already sorted — but never alter the dates themselves.
- Keep each entry's header line intact: "<Company> / <Role>" (or project name) followed by its date range, then its bullets. Do not merge entries or move bullets between entries.
- **Lead bullets with strong past-tense action verbs** (Built, Led, Designed, Shipped, Migrated, Reduced…); the current role may use present tense. Avoid weak openers ("Responsible for", "Worked on", "Helped with").
- Order the bullets within each role by impact — most significant/relevant achievement first.
- Summary: 2–4 tight sentences — seniority + years + core stack + domain strengths, tuned to the JD.
- Skills: grouped by category, most JD-relevant categories first.
- Standard section order for a reverse-chronological CV: Summary → Skills → Experience → Projects → Education (and any extras last). Education stays after experience for an experienced candidate.
- One idea per bullet; keep bullets concise and parallel in grammatical structure.

## LAYOUT & LENGTH
- Target a full, well-filled page (or pages). If the original CV is sparse, enrich existing entries until the page reads as complete and balanced — never with filler, always with relevant, JD-aligned substance.
- Expand the Summary into a fuller, denser paragraph; add depth to each Experience/Project bullet; broaden the Skills section to cover every JD-relevant tool the candidate genuinely has.
- It is good if a section grows. It is never acceptable for a section to shrink.

## READABILITY — KEEP IT SCANNABLE FOR HR (critical)
- An HR reviewer skims. NEVER produce a wall of text. Each bullet is ONE idea, roughly 1–2 lines (~15–30 words). If a point needs more, split it into multiple separate bullets — do NOT merge several ideas into one long sentence.
- "Expand" means MORE bullets and richer individual points, NOT longer run-on bullets. Prefer 5 tight bullets over 2 bloated ones.
- SKILLS formatting: output each skill category on its OWN line, formatted "Category: item, item, item". Put a line break (\n) between categories. Do NOT chain multiple categories into a single paragraph. Keep each category's value to a clean comma-separated list; drop trailing prose like "with a focus on…".
- Use real line breaks (\n) between bullets and between skill categories so the structure is preserved.

## OUTPUT FORMAT
Return a single JSON object with a key for each section you rewrote. Each section value is a plain string (not nested JSON). Preserve the original section structure — do not add sections that didn't exist in the original CV. Every link in the original must appear, unchanged and in its original location, in the output.`;

// ---------------------------------------------------------------------------
// Per-section rewriting prompts
// ---------------------------------------------------------------------------

function _buildOptimizationPrompt(
  cvSections: CVSections,
  jdAnalysis: JDAnalysisResult,
  config: Required<OptimizeConfig>
): string {
  const atsInstruction =
    config.atsAggressiveness === 'high'
      ? 'Be highly aggressive with keyword placement — if a required skill is missing from a section, find any natural way to include it.'
      : config.atsAggressiveness === 'low'
      ? 'Prioritise readability. Include keywords only where they fit very naturally. Never force them.'
      : 'Balance readability with keyword coverage. Include all required keywords at least once.';

  const humanInstruction =
    config.humanizationLevel === 'high'
      ? 'The output must sound indistinguishable from an experienced professional writing their own CV. Use varied, natural phrasing. Avoid any phrases that sound AI-generated.'
      : config.humanizationLevel === 'low'
      ? 'Clarity and keyword coverage are the priority. Clean, direct language is fine.'
      : 'Aim for professional human tone with good readability.';

  const toneInstruction =
    config.tone === 'executive'
      ? 'Tone: authoritative and strategic. Emphasise leadership, vision, and business impact.'
      : config.tone === 'conversational'
      ? 'Tone: warm and approachable, but still professional. Avoid overly stiff corporate language.'
      : 'Tone: polished professional. Clear, confident, and results-focused.';

  // Build a focused keyword list
  const requiredKws = jdAnalysis.requiredSkills.slice(0, 20).join(', ');
  const preferredKws = jdAnalysis.preferredSkills.slice(0, 10).join(', ');
  const keywords = jdAnalysis.keywords.slice(0, 20).join(', ');

  // Identify which sections we have content for
  const sectionKeys = (Object.keys(cvSections) as Array<keyof CVSections>).filter(
    (k) => !['contact', 'raw'].includes(k as string) && cvSections[k] && String(cvSections[k]).trim().length > 0
  );

  const sectionsBlock = sectionKeys
    .map((k) => `### ${String(k).toUpperCase()}\n${cvSections[k]}`)
    .join('\n\n');

  return `## TASK
Rewrite the CV sections below to maximally match the target job description.

## TARGET JOB
- **Title**: ${jdAnalysis.jobTitle || 'Not specified'}
- **Company**: ${jdAnalysis.company || 'Not specified'}
- **Seniority**: ${jdAnalysis.seniorityLevel}
- **Required skills** (MUST appear in output): ${requiredKws || 'None specified'}
- **Preferred skills** (include if natural): ${preferredKws || 'None specified'}
- **ATS keywords to weave in**: ${keywords || 'None specified'}
- **Key responsibilities**: ${jdAnalysis.responsibilities.slice(0, 5).join(' | ')}
- **Industry terms**: ${jdAnalysis.industryTerms.slice(0, 10).join(', ')}

## CONSTRAINTS
- Target up to ${config.maxPages} page(s) and fill them — expand content to produce a full, well-balanced layout. Never reduce or cut content.
- ${toneInstruction}
- ${atsInstruction}
- ${humanInstruction}
- NEVER invent core facts: companies, job titles, dates, degrees, or numeric metrics not present in the original. You MAY add JD-aligned context and detail that elaborates existing entries.
- Preserve all dates, employer names, job titles, and institution names exactly.
- Preserve EVERY link (URL, email, LinkedIn/GitHub/portfolio) byte-for-byte, in its original location. Never remove, rewrite, shorten, or move a link.
- Required skills that genuinely don't appear in the candidate's background should NOT be added.

## SECTIONS TO REWRITE
${sectionsBlock}

## INSTRUCTIONS
For each section above, produce an optimised, EXPANDED version. Keep every original idea and bullet, then enrich each one — add the context, technical approach, and the job description's keywords/phrasing so an ATS scan matches more of them and the page fills out. Never delete or shorten a bullet; output for each section must be equal to or longer than the original. Do NOT add quantified metrics or percentages that are not already present; keep existing numbers only.

Preserve EVERY link exactly: any URL, email, or profile link (LinkedIn/GitHub/portfolio) stays byte-for-byte identical and in the same location within the text. Rewrite the words around a link only — never the link itself, and never move it.

Critically: do NOT repeat any phrase across bullets. The candidate's facts — companies, roles, dates, team sizes, tech stacks, project names — must come through unchanged. Expansion means richer description grounded in those facts, not fabricated employers, dates, or numbers.

Keep every bullet short and scannable (1–2 lines, one idea). Split any long point into several bullets rather than one run-on sentence — HR skims, so no walls of text. For SKILLS, put each category on its own line ("Category: a, b, c") separated by line breaks; never chain categories into one paragraph.

For Experience and Projects, output entries in reverse-chronological order (most recent first; ongoing "Present" roles before past ones) and start each bullet with a strong action verb. Keep every entry's header (company/role/project + date range) on its own line, immediately followed by that entry's bullets — never reorder bullets across different entries.

Return a JSON object where each key is the section name (lowercase, matching the sections above) and the value is the rewritten content as a plain string. Example:
{
  "summary": "...",
  "experience": "...",
  "skills": "..."
}

Return ONLY the JSON. No markdown code fences. No commentary.`;
}

// ---------------------------------------------------------------------------
// Diff utility — compare original vs optimised sections
// ---------------------------------------------------------------------------

function _buildDiff(original: CVSections, optimised: CVSections): Record<string, SectionDiff> {
  const diff: Record<string, SectionDiff> = {};
  for (const key of Object.keys(optimised) as Array<keyof CVSections>) {
    const orig = (String(original[key] || '')).trim();
    const optim = (String(optimised[key] || '')).trim();
    diff[key as string] = {
      changed: orig !== optim,
      lengthDelta: optim.length - orig.length,
      originalLength: orig.length,
      newLength: optim.length,
    };
  }
  return diff;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Optimise CV sections against a JD analysis.
 * Pass a session object (req.session) to use session-based AI credentials;
 * omit to fall back to env-based credentials (deprecated).
 */
export async function optimize(
  cvSections: CVSections,
  jdAnalysis: JDAnalysisResult,
  config: Record<string, unknown> = {},
  session?: { credentials?: SessionCredentials }
): Promise<OptimizeResult> {
  const mergedConfig: Required<OptimizeConfig> = { ...DEFAULT_CONFIG, ...config } as Required<OptimizeConfig>;

  // Pre-optimisation score (baseline)
  const baselineScore = atsScore(cvSections, jdAnalysis);

  const userPrompt = _buildOptimizationPrompt(cvSections, jdAnalysis, mergedConfig);

  const completionMessages = [
    { role: 'system' as const, content: MASTER_SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];
  const completionOptions = {
    maxTokens: 6000,
    temperature: mergedConfig.humanizationLevel === 'high' ? 0.5 : 0.3,
  };

  const result = session
    ? await createCompletionFromSession(session, completionMessages, completionOptions)
    : await createCompletion(completionMessages, completionOptions);

  let optimizedSections: CVSections;
  try {
    optimizedSections = parseJsonResponse(result.content) as CVSections;
  } catch (err) {
    throw new Error(`AI returned unparseable response during CV optimisation: ${(err as Error).message}`);
  }

  // Merge back any sections that the AI didn't touch
  for (const key of Object.keys(cvSections) as Array<keyof CVSections>) {
    if (key === 'contact' || key === 'raw') continue;
    if (optimizedSections[key] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (optimizedSections as any)[key as string] = cvSections[key];
    }
  }

  // Preserve contact and raw
  optimizedSections.contact = cvSections.contact;
  optimizedSections.raw = cvSections.raw;

  // Post-optimisation score
  const postScore = atsScore(optimizedSections, jdAnalysis);

  const diff = _buildDiff(cvSections, optimizedSections);

  return {
    optimizedSections,
    atsScore: {
      baseline: baselineScore,
      optimized: postScore,
      improvement: postScore.score - baselineScore.score,
    },
    diff,
    config: mergedConfig,
  };
}

export { DEFAULT_CONFIG };
