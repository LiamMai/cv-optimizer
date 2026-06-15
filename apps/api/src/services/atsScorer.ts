import { CVSections } from '../routes/cv';
import { JDAnalysisResult } from './jdAnalyzer';

export interface ATSScoreResult {
  score: number;          // 0–100
  matchPercent: number;   // keyword coverage %
  coveredKeywords: string[];
  missingKeywords: string[];
  weakSections: string[];
  suggestions: string[];
}

/**
 * Score a CV against a JD analysis.
 */
export function score(cvSections: CVSections, jdAnalysis: JDAnalysisResult): ATSScoreResult {
  const cvText = _buildCvText(cvSections);
  const cvTextLower = cvText.toLowerCase();

  // --- Keyword coverage ---
  const allKeywords = _dedup([
    ...jdAnalysis.requiredSkills,
    ...jdAnalysis.preferredSkills,
    ...jdAnalysis.keywords,
    ...jdAnalysis.industryTerms,
  ]);

  const coveredKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of allKeywords) {
    if (_containsKeyword(cvTextLower, kw)) {
      coveredKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const matchPercent =
    allKeywords.length > 0
      ? Math.round((coveredKeywords.length / allKeywords.length) * 100)
      : 0;

  // --- Required-skills penalty ---
  const requiredMissing = jdAnalysis.requiredSkills.filter(
    (kw) => !_containsKeyword(cvTextLower, kw)
  );
  const requiredCoverageScore =
    jdAnalysis.requiredSkills.length > 0
      ? (jdAnalysis.requiredSkills.length - requiredMissing.length) /
        jdAnalysis.requiredSkills.length
      : 1;

  // --- Section quality checks ---
  const weakSections: string[] = [];
  const suggestions: string[] = [];

  _checkSection(cvSections, 'summary', 50, weakSections, suggestions, 'Add a professional summary of at least 2–3 sentences.');
  _checkSection(cvSections, 'experience', 100, weakSections, suggestions, 'Expand your experience section with detailed bullet points.');
  _checkSection(cvSections, 'skills', 20, weakSections, suggestions, 'Add a skills section listing your technical and soft skills.');
  _checkSection(cvSections, 'education', 20, weakSections, suggestions, 'Add an education section.');

  const expText = cvSections.experience || '';

  // Check for action verbs
  const actionVerbs = ['led', 'built', 'developed', 'designed', 'implemented', 'managed', 'improved',
    'reduced', 'increased', 'created', 'launched', 'architected', 'delivered', 'optimised', 'optimized'];
  const verbCount = actionVerbs.filter((v) => new RegExp(`\\b${v}\\b`, 'i').test(expText)).length;
  if (verbCount < 3) {
    suggestions.push('Start experience bullet points with strong action verbs (e.g., Led, Built, Delivered).');
  }

  // Missing required skills suggestions
  if (requiredMissing.length > 0) {
    suggestions.push(
      `Your CV is missing these required skills: ${requiredMissing.slice(0, 5).join(', ')}${requiredMissing.length > 5 ? '…' : ''}.`
    );
  }

  // Preferred skills suggestions
  const preferredMissing = jdAnalysis.preferredSkills.filter(
    (kw) => !_containsKeyword(cvTextLower, kw)
  );
  if (preferredMissing.length > 0 && preferredMissing.length <= 5) {
    suggestions.push(
      `Consider adding these preferred skills if applicable: ${preferredMissing.join(', ')}.`
    );
  }

  // --- Composite score ---
  // Weights: keyword coverage 40%, required-skill coverage 40%, section quality 20%
  const sectionQualityScore = Math.max(0, 1 - weakSections.length * 0.15);
  const rawScore =
    matchPercent * 0.4 +
    requiredCoverageScore * 100 * 0.4 +
    sectionQualityScore * 100 * 0.2;

  const finalScore = Math.min(100, Math.round(rawScore));

  return {
    score: finalScore,
    matchPercent,
    coveredKeywords,
    missingKeywords,
    weakSections,
    suggestions,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _buildCvText(sections: CVSections): string {
  return Object.values(sections)
    .map((v) => (typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : ''))
    .join(' ');
}

function _containsKeyword(text: string, keyword: string): boolean {
  // Escape special regex characters, allow partial word match for compound terms
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function _dedup(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim().toLowerCase()))].filter(Boolean);
}

function _checkSection(
  sections: CVSections,
  key: keyof CVSections,
  minLength: number,
  weakSections: string[],
  suggestions: string[],
  suggestion: string
): void {
  const val = sections[key] || '';
  const text = typeof val === 'string' ? val : '';
  if (text.trim().length < minLength) {
    weakSections.push(key as string);
    suggestions.push(suggestion);
  }
}
