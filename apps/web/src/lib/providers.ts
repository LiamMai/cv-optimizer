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
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (best quality)' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (fastest)' },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B' },
    ],
  },
];
