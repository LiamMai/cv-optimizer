'use client';

import { create } from 'zustand';
import type { AuthState } from '@/lib/types';

interface AuthStore {
  auth: AuthState;
  loading: boolean;
  setAuth: (auth: AuthState) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  auth: { authenticated: false },
  loading: true,
  setAuth: (auth) => set({ auth, loading: false }),
  setLoading: (loading) => set({ loading }),
  clearAuth: () => set({ auth: { authenticated: false }, loading: false }),
}));
