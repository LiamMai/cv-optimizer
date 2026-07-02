import type { ProviderInfo } from './types';

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini-oauth',
    name: 'Google (Gemini)',
    description: 'Sign in with Google — free, 1,500 requests/day',
    free: true,
  },
  {
    id: 'groq-free',
    name: 'Free AI',
    description: 'Free, no key, no sign-in. Pick a model below.',
    free: true,
    keyless: true,
    models: [
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B (best quality)' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (long CVs — biggest free limit)' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (fastest)' },
    ],
  },
];
