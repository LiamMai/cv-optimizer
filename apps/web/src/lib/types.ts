export interface CVSection {
  type: string;
  title: string;
  content: string;
  items?: CVItem[];
}

export interface CVItem {
  title?: string;
  company?: string;
  duration?: string;
  location?: string;
  bullets?: string[];
  description?: string;
}

export interface ParsedCV {
  id: string;
  fileName: string;
  rawText: string;
  sections: CVSection[];
}

export interface JDAnalysis {
  requiredSkills: string[];
  preferredSkills: string[];
  yearsOfExperience: string;
  keywords: string[];
  seniorityLevel: string;
  responsibilities: string[];
  industryTerms: string[];
  jobTitle?: string;
  company?: string;
}

export interface ATSScore {
  score: number;
  matchPercent: number;
  coveredKeywords: string[];
  missingKeywords: string[];
  weakSections: string[];
  suggestions: string[];
  breakdown: {
    keywordScore: number;
    skillScore: number;
    sectionScore: number;
  } | null;
}

export interface OptimizationConfig {
  maxPages: 1 | 2 | 3;
  tone: 'professional' | 'conversational' | 'executive';
  atsAggressiveness: 'low' | 'medium' | 'high';
  humanizationLevel: 'low' | 'medium' | 'high';
}

export interface SectionDiff {
  sectionType: string;
  original: string;
  optimized: string;
  accepted: boolean;
}

export interface CVContact {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  website?: string;
  [key: string]: string | undefined;
}

export interface OptimizationResult {
  originalSections: CVSection[];
  optimizedSections: CVSection[];
  atsScore: ATSScore;
  diff: SectionDiff[];
  contact?: CVContact;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface OptimizationJob {
  id: string;
  cvId: string;
  jdId: string;
  config: OptimizationConfig;
  status: JobStatus;
  result?: OptimizationResult;
  error?: string;
}

export interface AuthState {
  authenticated: boolean;
  provider?: AIProvider;
  model?: string;
  user?: { email: string; name: string; picture?: string };
}

export type AIProvider = 'gemini-oauth' | 'groq-free';

export interface AIModelOption {
  id: string;
  name: string;
}

export interface ProviderInfo {
  id: AIProvider;
  name: string;
  description: string;
  free?: boolean;
  /** True if no sign-in / API key is required. */
  keyless?: boolean;
  /** Selectable models for this provider (model picker). */
  models?: AIModelOption[];
}
