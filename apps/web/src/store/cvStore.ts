'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedCV, JDAnalysis, OptimizationJob, OptimizationConfig } from '@/lib/types';
import type { DiffDecision } from '@/lib/diff';

interface JDState {
  id: string;
  text: string;
  analysis: JDAnalysis;
  /** Resolved company name (user-typed or auto-extracted from the JD). */
  company?: string;
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
  /** Per-hunk decisions keyed by diff hunk id (`${sectionType}#${index}`). */
  diffDecisions: Record<string, DiffDecision>;

  // Actions
  setCv: (cv: ParsedCV) => void;
  setJd: (jd: JDState) => void;
  setOptimizationJob: (job: OptimizationJob) => void;
  updateOptimizationJob: (updates: Partial<OptimizationJob>) => void;
  /** Set or toggle-off a hunk decision; passing the current value clears it (back to pending). */
  setDiffDecision: (hunkId: string, decision: DiffDecision) => void;
  setManyDecisions: (decisions: Record<string, DiffDecision>) => void;
  clearDecisions: () => void;
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
      diffDecisions: {},

      setCv: (cv) => set({ cv }),

      setJd: (jd) => set({ jd }),

      setOptimizationJob: (job) => set({ optimizationJob: job, diffDecisions: {} }),

      updateOptimizationJob: (updates) =>
        set((state) => ({
          optimizationJob: state.optimizationJob
            ? { ...state.optimizationJob, ...updates }
            : null,
        })),

      setDiffDecision: (hunkId, decision) =>
        set((state) => {
          const next = { ...state.diffDecisions };
          if (next[hunkId] === decision) {
            delete next[hunkId]; // toggle off → back to pending
          } else {
            next[hunkId] = decision;
          }
          return { diffDecisions: next };
        }),

      setManyDecisions: (decisions) =>
        set((state) => ({ diffDecisions: { ...state.diffDecisions, ...decisions } })),

      clearDecisions: () => set({ diffDecisions: {} }),

      setConfig: (config) =>
        set((state) => ({ config: { ...state.config, ...config } })),

      reset: () =>
        set({
          cv: null,
          jd: null,
          optimizationJob: null,
          config: defaultConfig,
          diffDecisions: {},
        }),
    }),
    {
      name: 'cv-optimizer-store',
      partialize: (state) => ({
        cv: state.cv,
        jd: state.jd,
        optimizationJob: state.optimizationJob,
        config: state.config,
        diffDecisions: state.diffDecisions,
      }),
    }
  )
);
