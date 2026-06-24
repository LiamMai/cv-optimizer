'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { ConnectProviderModal } from '@/components/auth/ConnectProviderModal';

function AuthPageInner() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    session_failed: 'Session could not be established. Please try again.',
    access_denied: 'Access was denied. Please try a different sign-in method.',
    unknown: 'An unexpected error occurred. Please try again.',
  };

  const errorMessage = error ? (errorMessages[error] ?? errorMessages.unknown) : null;

  return (
    <div>
      {errorMessage && (
        <div className="mx-auto mt-6 max-w-lg px-4">
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle size={16} className="shrink-0" />
            {errorMessage}
          </div>
        </div>
      )}
      <ConnectProviderModal />
    </div>
  );
}

// useSearchParams() must sit under a Suspense boundary or the production build fails.
export default function AuthPage() {
  return (
    <Suspense fallback={<ConnectProviderModal />}>
      <AuthPageInner />
    </Suspense>
  );
}
