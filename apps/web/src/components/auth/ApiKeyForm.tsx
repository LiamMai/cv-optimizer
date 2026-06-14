'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { connectApiKey } from '@/lib/api';
import type { AIProvider, ProviderInfo } from '@/lib/types';

interface ApiKeyFormProps {
  provider: ProviderInfo;
  onSuccess: () => void;
}

export function ApiKeyForm({ provider, onSuccess }: ApiKeyFormProps) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Please enter your API key.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await connectApiKey(provider.id as AIProvider, trimmed);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect. Please check your key and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <div>
        <label htmlFor="api-key-input" className="mb-1.5 block text-xs font-semibold text-slate-700">
          {provider.name} API Key
        </label>

        <div className="relative">
          <input
            id="api-key-input"
            type={visible ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider.keyPlaceholder ?? 'Paste your API key...'}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-10 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-colors"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
            aria-label={visible ? 'Hide API key' : 'Show API key'}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {provider.keyHint && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-400">
            <ExternalLink size={11} />
            {provider.keyHint}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <Button
        type="submit"
        loading={loading}
        disabled={!key.trim()}
        className="w-full"
      >
        {loading ? 'Connecting...' : 'Connect'}
      </Button>
    </form>
  );
}
