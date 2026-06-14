import { createCompletion, createCompletionFromSession, parseJsonResponse, SessionCredentials } from './aiProvider';

const SYSTEM_PROMPT = `You are an expert technical recruiter and NLP specialist who extracts structured information from job descriptions.
You return ONLY valid JSON with no extra commentary. Extract information that is explicitly stated in the job description — do NOT invent requirements.`;

export interface YearsExperience {
  min: number | null;
  max: number | null;
  raw: string;
}

export interface JDAnalysisResult {
  jobTitle: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  yearsExperience: YearsExperience;
  keywords: string[];
  seniorityLevel: string;
  responsibilities: string[];
  industryTerms: string[];
  educationRequirements: string[];
  employmentType: string;
  location: string;
  salaryRange: string;
}

/**
 * Analyse a job description text and extract structured requirements.
 * Pass a session object (req.session) to use session-based AI credentials;
 * omit to fall back to env-based credentials (deprecated).
 */
export async function analyzeJD(
  text: string,
  session?: { credentials?: SessionCredentials }
): Promise<JDAnalysisResult> {
  if (!text || text.trim().length < 50) {
    throw new Error('Job description text is too short to analyse (minimum 50 characters).');
  }

  const userPrompt = `Analyse the following job description and return a JSON object with these exact keys:

- jobTitle (string): the exact job title
- company (string): company name if present, otherwise ""
- requiredSkills (string[]): skills/technologies explicitly listed as required or "must have"
- preferredSkills (string[]): skills listed as "nice to have", "preferred", "bonus", or "plus"
- yearsExperience (object): { min: number|null, max: number|null, raw: string } — e.g. {"min":3,"max":5,"raw":"3-5 years"}
- keywords (string[]): ATS-relevant keywords and phrases a candidate should include in their CV (include job title, department, technical terms, methodologies)
- seniorityLevel (string): one of "intern", "junior", "mid", "senior", "lead", "principal", "manager", "director", "executive", "unknown"
- responsibilities (string[]): key responsibilities/duties listed (max 10, concise)
- industryTerms (string[]): domain-specific jargon, frameworks, standards, certifications mentioned (separate from generic skills)
- educationRequirements (string[]): required or preferred degrees/certifications
- employmentType (string): "full-time", "part-time", "contract", "freelance", "internship", or "unknown"
- location (string): location or "remote" / "hybrid" if stated, otherwise ""
- salaryRange (string): salary if stated, otherwise ""

Job Description:
"""
${text}
"""

Return ONLY the JSON object. No markdown, no explanation.`;

  const completionMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];
  const completionOptions = { maxTokens: 2048, temperature: 0.1 };

  const result = session
    ? await createCompletionFromSession(session, completionMessages, completionOptions)
    : await createCompletion(completionMessages, completionOptions);

  const parsed = parseJsonResponse(result.content) as Record<string, unknown>;

  // Normalise and provide defaults for every field
  return {
    jobTitle: String(parsed.jobTitle || ''),
    company: String(parsed.company || ''),
    requiredSkills: _toStringArray(parsed.requiredSkills),
    preferredSkills: _toStringArray(parsed.preferredSkills),
    yearsExperience: _normaliseYears(parsed.yearsExperience),
    keywords: _toStringArray(parsed.keywords),
    seniorityLevel: String(parsed.seniorityLevel || 'unknown'),
    responsibilities: _toStringArray(parsed.responsibilities),
    industryTerms: _toStringArray(parsed.industryTerms),
    educationRequirements: _toStringArray(parsed.educationRequirements),
    employmentType: String(parsed.employmentType || 'unknown'),
    location: String(parsed.location || ''),
    salaryRange: String(parsed.salaryRange || ''),
  };
}

function _toStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') return val.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function _normaliseYears(val: unknown): YearsExperience {
  if (!val) return { min: null, max: null, raw: '' };
  if (typeof val === 'object' && val !== null) {
    const obj = val as Record<string, unknown>;
    return {
      min: obj.min != null ? Number(obj.min) : null,
      max: obj.max != null ? Number(obj.max) : null,
      raw: String(obj.raw || ''),
    };
  }
  // Fallback: plain string like "3-5 years"
  const match = String(val).match(/(\d+)\s*[-–to]+\s*(\d+)/);
  if (match) return { min: Number(match[1]), max: Number(match[2]), raw: String(val) };
  const single = String(val).match(/(\d+)/);
  if (single) return { min: Number(single[1]), max: null, raw: String(val) };
  return { min: null, max: null, raw: String(val) };
}
