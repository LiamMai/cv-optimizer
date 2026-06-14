'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { ConnectProviderModal } from './ConnectProviderModal';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { auth, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-57px)] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={32} className="animate-spin" />
          <p className="text-sm">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return <ConnectProviderModal />;
  }

  return <>{children}</>;
}
