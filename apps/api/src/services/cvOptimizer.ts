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
  atsScore: {
    baseline: ATSScoreResult;
    optimized: ATSScoreResult;
    improvement: number;
  };
  diff: Record<string, SectionDiff>;
  config: Required<OptimizeConfig>;
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
Rewrite the provided CV sections so they are maximally aligned with the target job description WITHOUT fabricating any information. Every claim in the output must be traceable to something the candidate has already stated in their original CV.

## INVIOLABLE RULES (never break these)
1. **NO HALLUCINATION** — Do NOT invent: companies, job titles, dates, degrees, certifications, technologies, project names, numbers, or achievements that are not present in the original CV. If you are unsure whether something was implied, do not add it.
2. **PRESERVE FACTUAL ACCURACY** — All dates, employer names, job titles, academic institutions, and degrees must remain exactly as stated in the original.
3. **NO KEYWORD STUFFING** — Keywords must be woven naturally into sentences. Do not create bullet points that exist solely to list keywords with no context.
4. **HONEST FRAMING ONLY** — You may reframe, elevate, and articulate existing achievements more powerfully, but you may not exaggerate beyond what the original implies.
5. **NO BOILERPLATE CLAUSES** — Never append generic framing tails to bullets such as "with a focus on …", "utilizing …", "incorporating …", "while implementing …", "leveraging …". These are dead giveaways of machine stuffing.
6. **NO PHRASE REPETITION** — Do NOT reuse the same descriptive phrase across multiple bullets or sections. If a phrase already appears once, find different wording or omit it.
7. **PRESERVE, DON'T PAD** — A bullet's optimised length must stay close to the original. Do not lengthen a bullet just to insert keywords. If a keyword does not fit a bullet honestly, leave the bullet as-is.

## HUMAN-WRITING STANDARDS
To ensure the output reads as authentic human writing and passes AI-detection tools:
- Vary sentence length significantly — mix short punchy sentences (8–12 words) with longer, nuanced ones (20–30 words).
- Use first-person implied voice (no "I" — just action verbs: "Led a team…", "Delivered…").
- Avoid these AI-tell phrases: "In today's fast-paced environment", "I am passionate about", "proven track record", "results-driven", "leverage synergies", "utilize", "spearhead", "champion", "adept at", "dynamic", "multifaceted", "whilst" (unless British English is appropriate).
- Write bullet points that tell a story: Action → Context → Result (ACR format).
- Keep each bullet's original idea and meaning intact — your job is to re-word it using the job description's terminology, NOT to add new numbers, percentages, or metrics that aren't already there.
- Only keep a metric if it already exists in the original bullet; never invent or estimate one.
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

## OUTPUT FORMAT
Return a single JSON object with a key for each section you rewrote. Each section value is a plain string (not nested JSON). Preserve the original section structure — do not add sections that didn't exist in the original CV.`;

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
- Max pages: ${config.maxPages} (keep content appropriately concise)
- ${toneInstruction}
- ${atsInstruction}
- ${humanInstruction}
- NEVER invent facts, companies, technologies, or achievements not present in the original.
- Preserve all dates, employer names, job titles, and institution names exactly.
- Required skills that genuinely don't appear in the candidate's background should NOT be added.

## SECTIONS TO REWRITE
${sectionsBlock}

## INSTRUCTIONS
For each section above, produce an optimised version. Preserve the original ideas and content of every bullet — re-word them so they mirror the job description's keywords and phrasing so an ATS scan matches more of them. Do NOT add quantified metrics or percentages that are not already present in the original; keep existing numbers only.

Critically: do NOT append generic tails like "with a focus on cloud-based applications and front-end technologies" or "utilizing design patterns and semantic HTML" to bullets, and do NOT repeat any phrase across bullets. Keep each optimised bullet roughly the same length as the original. The candidate's facts — companies, roles, dates, team sizes, tech stacks, project names — must come through unchanged.

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
