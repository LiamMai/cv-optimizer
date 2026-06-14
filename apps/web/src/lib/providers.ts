import type { ProviderInfo } from './types';

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gemini-oauth',
    name: 'Google (Gemini)',
    description: 'Sign in with Google — free, 1,500 requests/day',
    free: true,
    requiresKey: false,
  },
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    description: 'Use your Anthropic API key — best quality',
    free: false,
    requiresKey: true,
    keyPlaceholder: 'sk-ant-...',
    keyHint: 'Get yours at console.anthropic.com',
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    description: 'Use your OpenAI API key — GPT-4o',
    free: false,
    requiresKey: true,
    keyPlaceholder: 'sk-...',
    keyHint: 'Get yours at platform.openai.com',
  },
  {
    id: 'gemini',
    name: 'Gemini (API Key)',
    description: 'Use your Google AI Studio API key',
    free: false,
    requiresKey: true,
    keyPlaceholder: 'AIza...',
    keyHint: 'Get yours at aistudio.google.com',
  },
  {
    id: 'groq',
    name: 'Groq (Free)',
    description: 'Free tier — LLaMA 3 70B, fast inference',
    free: true,
    requiresKey: true,
    keyPlaceholder: 'gsk_...',
    keyHint: 'Get your free key at console.groq.com',
  },
];
