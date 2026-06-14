'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FileText, Home, Plus, Clock, LogOut, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { logout } from '@/lib/api';

const navLinks = [
  { label: 'Dashboard', href: '/', icon: Home },
  { label: 'New CV', href: '/upload', icon: Plus },
  { label: 'History', href: '/history', icon: Clock },
];

const steps = [
  { label: 'Upload', paths: ['/upload'] },
  { label: 'Analyze', paths: ['/analysis'] },
  { label: 'Edit', paths: ['/editor'] },
  { label: 'Export', paths: ['/export'] },
];

const providerLabels: Record<string, string> = {
  'gemini-oauth': 'Google',
  claude: 'Claude',
  openai: 'GPT-4o',
  gemini: 'Gemini',
  groq: 'Groq',
};

function getActiveStep(pathname: string): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].paths.some((p) => pathname.startsWith(p))) return i;
  }
  return -1;
}

function AuthStatus() {
  const { auth, loading, clearAuth } = useAuthStore();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleDisconnect = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // ignore errors — clear client state regardless
    } finally {
      clearAuth();
      setLoggingOut(false);
      router.push('/');
    }
  };

  // Skeleton while loading
  if (loading) {
    return (
      <div className="h-7 w-28 animate-pulse rounded-full bg-slate-100" />
    );
  }

  if (auth.authenticated) {
    const providerLabel = auth.provider ? (providerLabels[auth.provider] ?? auth.provider) : 'Connected';

    return (
      <div className="flex items-center gap-2">
        {/* Provider badge */}
        <div className="flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          {auth.user?.name ? (
            <span className="hidden sm:inline">{auth.user.name.split(' ')[0]}</span>
          ) : null}
          <span className="text-green-600">via {providerLabel}</span>
        </div>

        {/* Disconnect button */}
        <button
          onClick={handleDisconnect}
          disabled={loggingOut}
          title="Disconnect AI provider"
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          <LogOut size={13} />
          <span className="hidden sm:inline">Disconnect</span>
        </button>
      </div>
    );
  }

  // Not authenticated
  return (
    <Link
      href="/auth"
      className="flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
    >
      <Wifi size={13} />
      Connect AI
    </Link>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const activeStep = getActiveStep(pathname);
  const isOnFlow = activeStep >= 0;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-primary-700 hover:text-primary-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-600 text-white">
            <FileText size={16} />
          </div>
          <span className="text-lg font-bold tracking-tight">CVOptimizer</span>
        </Link>

        {/* Step indicator (only shown during the flow) */}
        {isOnFlow && (
          <div className="hidden items-center gap-0 sm:flex">
            {steps.map((step, idx) => (
              <React.Fragment key={step.label}>
                {idx > 0 && (
                  <div
                    className={cn(
                      'h-px w-8 transition-colors',
                      idx <= activeStep ? 'bg-primary-500' : 'bg-slate-200'
                    )}
                  />
                )}
                <div className="flex flex-col items-center gap-0.5">
                  <div
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                      idx < activeStep
                        ? 'bg-primary-600 text-white'
                        : idx === activeStep
                        ? 'border-2 border-primary-600 bg-white text-primary-600'
                        : 'border-2 border-slate-200 bg-white text-slate-400'
                    )}
                  >
                    {idx < activeStep ? '✓' : idx + 1}
                  </div>
                  <span
                    className={cn(
                      'text-xs',
                      idx === activeStep ? 'font-semibold text-primary-600' : 'text-slate-400'
                    )}
                  >
                    {step.label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Right side: nav links + auth status */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {navLinks.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  pathname === href
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon size={15} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-slate-200" />

          <AuthStatus />
        </div>
      </div>
    </nav>
  );
}
