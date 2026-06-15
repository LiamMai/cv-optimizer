'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedCV, JDAnalysis, OptimizationJob, OptimizationConfig } from '@/lib/types';

interface JDState {
  id: string;
  text: string;
  analysis: JDAnalysis;
}

const defaultConfig: OptimizationConfig = {
  maxPages: 2,
  tone: 'professional',
  atsAggressiveness: 'medium',
  humanizationLevel: 'medium',
};

interface CVStore {
  cv: ParsedCV | null;
  jd: JDState | null;
  optimizationJob: OptimizationJob | null;
  config: OptimizationConfig;
  acceptedDiffs: string[];

  // Actions
  setCv: (cv: ParsedCV) => void;
  setJd: (jd: JDState) => void;
  setOptimizationJob: (job: OptimizationJob) => void;
  updateOptimizationJob: (updates: Partial<OptimizationJob>) => void;
  acceptDiff: (sectionType: string) => void;
  rejectDiff: (sectionType: string) => void;
  setConfig: (config: Partial<OptimizationConfig>) => void;
  reset: () => void;
}

export const useCVStore = create<CVStore>()(
  persist(
    (set) => ({
      cv: null,
      jd: null,
      optimizationJob: null,
      config: defaultConfig,
      acceptedDiffs: [],

      setCv: (cv) => set({ cv }),

      setJd: (jd) => set({ jd }),

      setOptimizationJob: (job) => set({ optimizationJob: job, acceptedDiffs: [] }),

      updateOptimizationJob: (updates) =>
        set((state) => ({
          optimizationJob: state.optimizationJob
            ? { ...state.optimizationJob, ...updates }
            : null,
        })),

      acceptDiff: (sectionType) =>
        set((state) => {
          const already = state.acceptedDiffs.includes(sectionType);
          if (already) return state;
          return { acceptedDiffs: [...state.acceptedDiffs, sectionType] };
        }),

      rejectDiff: (sectionType) =>
        set((state) => ({
          acceptedDiffs: state.acceptedDiffs.filter((s) => s !== sectionType),
        })),

      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } })),

      reset: () =>
        set({
          cv: null,
          jd: null,
          optimizationJob: null,
          config: defaultConfig,
          acceptedDiffs: [],
        }),
    }),
    {
      name: 'cv-optimizer-store',
      partialize: (state) => ({
        cv: state.cv,
        jd: state.jd,
        optimizationJob: state.optimizationJob,
        config: state.config,
        acceptedDiffs: state.acceptedDiffs,
      }),
    }
  )
);
