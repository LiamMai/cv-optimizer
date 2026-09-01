'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { checkAuth } from '@/lib/api';

export function useAuth() {
  const { auth, loading, setAuth, setLoading, clearAuth } = useAuthStore();

  useEffect(() => {
    // Cancels the in-flight request on cleanup so a duplicate mount (React StrictMode
    // in dev) can't leave its check as a stray, discarded network call.
    const controller = new AbortController();
    setLoading(true);
    checkAuth(controller.signal)
      .then(setAuth)
      .catch(() => {
        if (!controller.signal.aborted) clearAuth();
      });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { auth, loading };
}
