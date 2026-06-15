'use client';

import React from 'react';
import { Zap, AlertTriangle } from 'lucide-react';
import { GoogleSignInButton } from './GoogleSignInButton';

export function ConnectProviderModal() {
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
              Powered by Google Gemini — no API key needed, no cost.
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

          {/* Sign in */}
          <div className="border-t border-slate-100 px-6 pb-6 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              Sign in to continue
            </p>
            <GoogleSignInButton />
          </div>
        </div>
      </div>
    </div>
  );
}
