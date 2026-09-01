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
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B (fastest)' },
      { id: 'groq/compound-mini', name: 'Compound Mini (long CVs — biggest free limit)' },
    ],
  },
];
