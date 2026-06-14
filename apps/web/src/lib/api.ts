import axios from 'axios';
import type { ParsedCV, JDAnalysis, OptimizationConfig, OptimizationJob, AuthState, AIProvider } from './types';

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
  const response = await api.post<ParsedCV>('/cv/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function uploadCVText(text: string): Promise<ParsedCV> {
  const response = await api.post<ParsedCV>('/cv/upload-text', { text });
  return response.data;
}

export async function analyzeJD(text: string): Promise<{ id: string; analysis: JDAnalysis }> {
  const response = await api.post<{ id: string; analysis: JDAnalysis }>('/jd/analyze', { text });
  return response.data;
}

export async function startOptimization(
  cvId: string,
  jdId: string,
  config: OptimizationConfig
): Promise<{ jobId: string }> {
  const response = await api.post<{ jobId: string }>('/optimize', { cvId, jdId, config });
  return response.data;
}

export async function pollJobStatus(jobId: string): Promise<OptimizationJob> {
  const response = await api.get<OptimizationJob>(`/optimize/jobs/${jobId}`);
  return response.data;
}

export async function exportPDF(payload: { cvId?: string; jobId?: string }): Promise<Blob> {
  const response = await api.post('/export/pdf', payload, {
    responseType: 'blob',
  });
  return response.data;
}

export async function exportDOCX(payload: { cvId?: string; jobId?: string }): Promise<Blob> {
  const response = await api.post('/export/docx', payload, {
    responseType: 'blob',
  });
  return response.data;
}

export async function getCV(id: string): Promise<ParsedCV> {
  const response = await api.get<ParsedCV>(`/cv/${id}`);
  return response.data;
}

// Auth endpoints
export const checkAuth = (): Promise<AuthState> =>
  api.get('/auth/me').then(r => r.data);

export const connectApiKey = (provider: AIProvider, apiKey: string): Promise<{ success: boolean; provider: string }> =>
  api.post('/auth/api-key', { provider, apiKey }).then(r => r.data);

export const logout = (): Promise<void> =>
  api.delete('/auth/logout').then(() => undefined);

export const getGoogleAuthUrl = (): string =>
  `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/auth/google`;

export default api;
