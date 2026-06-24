'use client';

import React, { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { checkAuth } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

function Spinner() {
  return (
    <div className="flex min-h-[calc(100vh-57px)] items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-slate-400">
        <Loader2 size={36} className="animate-spin text-primary-500" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600">Completing sign-in...</p>
          <p className="mt-1 text-xs text-slate-400">Verifying your session with Google</p>
        </div>
      </div>
    </div>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth, clearAuth } = useAuthStore();

  useEffect(() => {
    checkAuth()
      .then((auth) => {
        if (auth.authenticated) {
          setAuth(auth);
          router.replace('/upload');
        } else {
          clearAuth();
          router.replace('/auth?error=session_failed');
        }
      })
      .catch(() => {
        clearAuth();
        const error = searchParams.get('error') ?? 'unknown';
        router.replace(`/auth?error=${error}`);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Spinner />;
}

// useSearchParams() must sit under a Suspense boundary or the production build fails.
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthCallbackInner />
    </Suspense>
  );
}
