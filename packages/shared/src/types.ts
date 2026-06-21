export interface CVSection {
  type: 'summary' | 'experience' | 'education' | 'skills' | 'certifications' | 'projects' | 'languages' | 'contact';
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
  contact?: ContactInfo;
}

export interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  website?: string;
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
  };
}

export interface OptimizationConfig {
  maxPages: 1 | 2 | 3;
  tone: 'professional' | 'technical' | 'executive' | 'minimal';
  atsAggressiveness: 'low' | 'medium' | 'high';
  humanizationLevel: 'low' | 'medium' | 'high';
  creativityLevel: 'low' | 'medium' | 'high';
}

export interface OptimizationResult {
  originalSections: CVSection[];
  optimizedSections: CVSection[];
  atsScore: ATSScore;
  diff: SectionDiff[];
  contact?: ContactInfo;
  // --- "Modify CV from user data" jobs only ---
  kind?: 'optimize' | 'modify';
  /** Human-readable summary of each edit the AI made. */
  changes?: string[];
  /** Content the AI dropped or recommends dropping (user confirms via reject). */
  removed?: string[];
  /** Follow-up questions where the user's data was too thin to write a strong bullet. */
  needsMoreInfo?: { section: string; question: string }[];
  /** The raw notes the user submitted — appended to when re-running with more notes. */
  sourceNotes?: string;
}

export interface SectionDiff {
  sectionType: string;
  original: string;
  optimized: string;
  accepted: boolean;
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
  createdAt: Date;
  updatedAt: Date;
}

export type AIProvider = 'claude' | 'openai';
