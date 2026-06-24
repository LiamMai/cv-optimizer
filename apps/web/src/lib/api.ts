import axios from 'axios';
import type { ParsedCV, JDAnalysis, OptimizationConfig, OptimizationJob, AuthState } from './types';

const api = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1`,
  timeout: 30000,
  withCredentials: true, // send session cookie on every request
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

export async function uploadCV(file: File): Promise<ParsedCV> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<{ message: string; cv: ParsedCV }>('/cv/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data.cv;
}

export async function uploadCVText(text: string): Promise<ParsedCV> {
  const response = await api.post<{ message: string; cv: ParsedCV }>('/cv/upload-text', { text });
  return response.data.cv;
}

export async function analyzeJD(text: string): Promise<{ id: string; analysis: JDAnalysis }> {
  const response = await api.post<{ message: string; jd: { id: string; text: string; analysis: JDAnalysis } }>('/jd/analyze', { text });
  return { id: response.data.jd.id, analysis: response.data.jd.analysis };
}

export async function startOptimization(
  cvId: string,
  jdId: string,
  config: OptimizationConfig
): Promise<{ jobId: string }> {
  const response = await api.post<{ jobId: string }>('/optimize', { cvId, jdId, config });
  return response.data;
}

export async function startModification(
  cvId: string,
  userData: string,
  config?: { maxPages?: number; tone?: 'professional' | 'conversational' | 'executive' }
): Promise<{ jobId: string }> {
  const response = await api.post<{ jobId: string }>('/modify', { cvId, userData, config });
  return response.data;
}

function _sectionsObjToArray(obj: Record<string, unknown> | null | undefined): import('./types').CVSection[] {
  if (!obj || typeof obj !== 'object') return [];
  const IGNORE = new Set(['contact', 'raw']);
  return Object.entries(obj)
    .filter(([k, v]) => !IGNORE.has(k) && typeof v === 'string' && (v as string).trim())
    .map(([type, content]) => ({
      type,
      title: type.charAt(0).toUpperCase() + type.slice(1),
      content: content as string,
    }));
}

export async function pollJobStatus(jobId: string): Promise<OptimizationJob> {
  const response = await api.get<any>(`/optimize/${jobId}`);
  const data = response.data;

  // API returns `jobId` not `id`, and `running` not `processing`
  const job: OptimizationJob = {
    id: data.id ?? data.jobId ?? jobId,
    cvId: data.cvId ?? '',
    jdId: data.jdId ?? '',
    config: data.config ?? {},
    status: data.status === 'running' ? 'processing' : data.status,
    error: data.error ?? undefined,
  };

  if (data.result) {
    const rawAts = data.result.atsScore;
    const ats = rawAts?.optimized ?? rawAts ?? {};

    const originalSections = _sectionsObjToArray(data.result.originalSections);
    const optimizedSections = _sectionsObjToArray(data.result.optimizedSections);

    // API diff is Record<sectionType, {changed, ...}> — convert to SectionDiff[]
    const diffRecord: Record<string, { changed: boolean }> = data.result.diff ?? {};
    const diff = Object.entries(diffRecord)
      .filter(([, d]) => d.changed)
      .map(([sectionType]) => ({
        sectionType,
        original: originalSections.find((s) => s.type === sectionType)?.content ?? '',
        optimized: optimizedSections.find((s) => s.type === sectionType)?.content ?? '',
        accepted: false,
      }));

    const contact =
      (data.result.optimizedSections?.contact as Record<string, string> | undefined) ??
      (data.result.originalSections?.contact as Record<string, string> | undefined);

    job.result = {
      originalSections,
      optimizedSections,
      diff,
      contact,
      atsScore: {
        score: ats.score ?? 0,
        matchPercent: ats.matchPercent ?? 0,
        coveredKeywords: ats.coveredKeywords ?? [],
        missingKeywords: ats.missingKeywords ?? [],
        weakSections: ats.weakSections ?? [],
        suggestions: ats.suggestions ?? [],
        breakdown: ats.breakdown ?? null,
      },
      // "Modify CV" job fields — undefined for normal optimize jobs.
      kind: data.result.kind,
      changes: data.result.changes,
      removed: data.result.removed,
      needsMoreInfo: data.result.needsMoreInfo,
      sourceNotes: data.result.userData,
    };
  }

  return job;
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

// Pull the server-suggested filename out of the Content-Disposition header,
// falling back to a default when it's absent.
function _filenameFromResponse(headers: Record<string, unknown>, fallback: string): string {
  const cd = (headers['content-disposition'] || headers['Content-Disposition']) as string | undefined;
  if (!cd) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  return match ? decodeURIComponent(match[1]) : fallback;
}

export interface ExportPayload {
  cvId?: string;
  jobId?: string;
  /** Per-section content overrides (e.g. sections with rejected changes). */
  sections?: Record<string, string>;
}

export async function exportPDF(payload: ExportPayload): Promise<ExportFile> {
  const response = await api.post('/export/pdf', payload, {
    responseType: 'blob',
  });
  return { blob: response.data, filename: _filenameFromResponse(response.headers, 'cv-optimized.pdf') };
}

export async function exportDOCX(payload: ExportPayload): Promise<ExportFile> {
  const response = await api.post('/export/docx', payload, {
    responseType: 'blob',
  });
  return { blob: response.data, filename: _filenameFromResponse(response.headers, 'cv-optimized.docx') };
}

export async function getCV(id: string): Promise<ParsedCV> {
  const response = await api.get<ParsedCV>(`/cv/${id}`);
  return response.data;
}

// Auth endpoints
export const checkAuth = (): Promise<AuthState> =>
  api.get('/auth/me').then(r => r.data);

export const logout = (): Promise<void> =>
  api.delete('/auth/logout').then(() => undefined);

export const getGoogleAuthUrl = (): string =>
  `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/auth/google`;

// Connect the free, keyless Pollinations provider with a chosen model.
export const connectFree = (model: string): Promise<{ provider: string; model: string }> =>
  api.post('/auth/free', { model }).then((r) => r.data);

// Submit a BYO provider API key — encrypted + held in the session server-side, never echoed back.
export const connectApiKey = (
  provider: string,
  apiKey: string
): Promise<{ success: boolean; provider: string }> =>
  api.post('/auth/api-key', { provider, apiKey }).then((r) => r.data);

export default api;
