'use client';

import React, { useState } from 'react';
import { Lock, Shield } from 'lucide-react';
import { PROVIDERS } from '@/lib/providers';
import type { ProviderInfo } from '@/lib/types';
import { ProviderCard } from './ProviderCard';
import { ApiKeyForm } from './ApiKeyForm';
import { GoogleSignInButton } from './GoogleSignInButton';
import { useAuthStore } from '@/store/authStore';
import { checkAuth } from '@/lib/api';

export function ConnectProviderModal() {
  const [selected, setSelected] = useState<ProviderInfo | null>(null);
  const { setAuth } = useAuthStore();

  const handleApiKeySuccess = async () => {
    try {
      const auth = await checkAuth();
      setAuth(auth);
    } catch {
      // clearAuth handled by AuthGuard re-check
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="border-b border-slate-100 px-6 pt-6 pb-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
              <Shield size={22} className="text-primary-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Connect AI Provider</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Your credentials are encrypted and stored server-side. Never stored in your browser.
            </p>
          </div>

          {/* Provider grid */}
          <div className="px-6 pt-5 pb-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Choose a provider
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PROVIDERS.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  selected={selected?.id === provider.id}
                  onSelect={() => setSelected(provider)}
                />
              ))}
            </div>
          </div>

          {/* Action area */}
          {selected && (
            <div className="border-t border-slate-100 px-6 pb-5 pt-4">
              {selected.id === 'gemini-oauth' ? (
                <GoogleSignInButton />
              ) : (
                <ApiKeyForm provider={selected} onSuccess={handleApiKeySuccess} />
              )}
            </div>
          )}

          {/* Security footer */}
          <div className="rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-4">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Lock size={13} className="shrink-0 text-slate-400" />
              <span>
                <span className="font-semibold text-slate-600">256-bit encrypted</span>
                {' · '}
                <span className="font-semibold text-slate-600">2-hour session</span>
                {' · '}
                <span className="font-semibold text-slate-600">HTTP-only cookie</span>
                {' · '}
                Your key is never returned to the browser
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
