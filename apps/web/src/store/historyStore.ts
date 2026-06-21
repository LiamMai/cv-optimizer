'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * A single record of a job the user optimized their CV against.
 * Purpose: remember which companies/roles have been applied to.
 * Persisted to localStorage (key `cv-optimizer-history`).
 */
export interface HistoryEntry {
  /** Same id as the optimization job — used to re-open results. */
  id: string;
  /** Company name: typed by the user, or auto-extracted from the JD, or "". */
  company: string;
  /** Whether `company` was auto-filled from the JD analysis (vs. typed). */
  companyAutofilled: boolean;
  jobTitle: string;
  cvId: string;
  jdId: string;
  /** ISO timestamp when the optimization was started. */
  appliedAt: string;
  /** Optimized ATS score, filled in once the job completes. */
  atsScore?: number;
}

interface HistoryStore {
  entries: HistoryEntry[];
  addEntry: (entry: HistoryEntry) => void;
  /** Patch an existing entry by id (e.g. set the ATS score on completion). */
  updateEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  removeEntry: (id: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryStore>()(
  persist(
    (set) => ({
      entries: [],

      addEntry: (entry) =>
        set((state) => ({
          // newest first; replace any existing entry with the same id
          entries: [entry, ...state.entries.filter((e) => e.id !== entry.id)],
        })),

      updateEntry: (id, updates) =>
        set((state) => ({
          entries: state.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        })),

      removeEntry: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    { name: 'cv-optimizer-history' }
  )
);
