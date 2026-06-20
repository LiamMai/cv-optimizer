'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Zap, AlertTriangle, Loader2 } from 'lucide-react';
import { GoogleSignInButton } from './GoogleSignInButton';
import { PROVIDERS } from '@/lib/providers';
import { connectFree, checkAuth } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

const freeProvider = PROVIDERS.find((p) => p.id === 'groq-free');
const MODELS = freeProvider?.models ?? [];

export function ConnectProviderModal() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [model, setModel] = React.useState(MODELS[0]?.id ?? 'llama-3.3-70b-versatile');
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFreeConnect() {
    setConnecting(true);
    setError(null);
    try {
      await connectFree(model);
      const auth = await checkAuth();
      if (!auth.authenticated) throw new Error('Session not established');
      setAuth(auth);
      router.replace('/upload');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setConnecting(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-57px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xl">
          {/* Header */}
          <div className="border-b border-slate-100 px-6 pt-6 pb-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-green-100">
              <Zap size={22} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Free AI Mode</h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Pick a model and start — no API key, no cost.
            </p>
          </div>

          {/* Free AI notice */}
          <div className="px-6 pt-5 pb-4">
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-700">
                Free AI — responses may be slow or temporarily unavailable due to rate limits. No guarantees on availability.
              </p>
            </div>
          </div>

          {/* Model picker (keyless Pollinations) */}
          <div className="px-6 pb-2">
            <label htmlFor="ai-model" className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-slate-400">
              AI Model
            </label>
            <select
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={connecting}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-60"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <button
              type="button"
              onClick={handleFreeConnect}
              disabled={connecting}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 disabled:opacity-60"
            >
              {connecting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              {connecting ? 'Connecting...' : 'Start with free AI'}
            </button>
          </div>

          {/* Google sign-in alternative */}
          <div className="border-t border-slate-100 px-6 pb-6 pt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Or sign in with Google
            </p>
            <GoogleSignInButton />
          </div>
        </div>
      </div>
    </div>
  );
}
