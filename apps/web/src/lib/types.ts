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
  };
}

export interface OptimizationConfig {
  maxPages: 1 | 2 | 3;
  tone: 'professional' | 'technical' | 'executive' | 'minimal';
  atsAggressiveness: 'low' | 'medium' | 'high';
  humanizationLevel: 'low' | 'medium' | 'high';
  creativityLevel: 'low' | 'medium' | 'high';
}

export interface SectionDiff {
  sectionType: string;
  original: string;
  optimized: string;
  accepted: boolean;
}

export interface OptimizationResult {
  originalSections: CVSection[];
  optimizedSections: CVSection[];
  atsScore: ATSScore;
  diff: SectionDiff[];
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
  provider?: 'gemini-oauth' | 'claude' | 'openai' | 'gemini' | 'groq';
  user?: { email: string; name: string; picture?: string };
}

export type AIProvider = 'gemini-oauth' | 'claude' | 'openai' | 'gemini' | 'groq';

export interface ProviderInfo {
  id: AIProvider;
  name: string;
  description: string;
  free: boolean;
  requiresKey: boolean;
  keyPlaceholder?: string;
  keyHint?: string;
}
