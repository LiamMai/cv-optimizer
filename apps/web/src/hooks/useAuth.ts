'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { checkAuth } from '@/lib/api';

export function useAuth() {
  const { auth, loading, setAuth, setLoading, clearAuth } = useAuthStore();

  useEffect(() => {
    setLoading(true);
    checkAuth()
      .then(setAuth)
      .catch(() => clearAuth());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { auth, loading };
}
