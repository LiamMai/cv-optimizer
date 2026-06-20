import config from '../config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { decrypt } from './encryption';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AIProvider = 'claude' | 'openai';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  usage: {
    inputTokens: number | undefined;
    outputTokens: number | undefined;
  };
}

export interface SessionCredentials {
  provider: 'gemini-oauth' | 'claude' | 'openai' | 'gemini' | 'groq' | 'groq-free';
  encryptedApiKey?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  tokenExpiry?: number;
  /** User-selected model id (used by the keyless `groq-free` provider). */
  model?: string;
}

/**
 * Free, keyless models exposed in the model picker. These run on the server's
 * shared Groq key (no per-user API key, no sign-in) — reliable and fast, unlike
 * the anonymous public endpoints which rate-limit and truncate long JSON output.
 */
export const FREE_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
] as const;
export const DEFAULT_FREE_MODEL = 'llama-3.3-70b-versatile';

// ---------------------------------------------------------------------------
// Retry / timeout policy
// ---------------------------------------------------------------------------

/** Per-request timeout for a single AI call attempt (ms). */
const AI_TIMEOUT_MS = 120_000;
/** Number of extra attempts after the first on transient failures. */
const AI_MAX_RETRIES = 3;
/** Base backoff between attempts (ms); grows exponentially. */
const AI_RETRY_BASE_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decide whether an error is worth retrying (network blips, timeouts, 429, 5xx). */
function _isRetryable(err: unknown): boolean {
  const e = err as { status?: number; name?: string; code?: string; message?: string };
  if (e?.status && (e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500)) {
    return true;
  }
  if (e?.name === 'AbortError') return true;
  const code = e?.code || '';
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  const msg = (e?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out') || msg.includes('network');
}

/**
 * Run an AI call with retries on transient failures and exponential backoff.
 * Non-retryable errors (auth, bad request) throw immediately.
 */
async function _withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === AI_MAX_RETRIES || !_isRetryable(err)) break;
      const delay = AI_RETRY_BASE_MS * 2 ** attempt;
      // eslint-disable-next-line no-console
      console.warn(
        `[aiProvider] ${label} attempt ${attempt + 1} failed (${(err as Error)?.message}); retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Singleton clients for env-based providers
// ---------------------------------------------------------------------------

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: config.ai.anthropicApiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  }
  return _anthropic;
}

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: config.ai.openaiApiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });
  }
  return _openai;
}

// ---------------------------------------------------------------------------
// Per-provider call helpers
// ---------------------------------------------------------------------------

async function callClaude(
  apiKey: string,
  messages: Message[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });

  let system = '';
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      anthropicMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.ai.anthropicModel,
    max_tokens: maxTokens,
    temperature,
    messages: anthropicMessages,
  };
  if (system) params.system = system;

  const response = await _withRetry('claude', () => client.messages.create(params));
  const content = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    content,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };
}

async function callOpenAI(
  apiKey: string,
  messages: Message[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: AI_TIMEOUT_MS });

  const response = await _withRetry('openai', () =>
    client.chat.completions.create({
      model: config.ai.openaiModel,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: maxTokens,
      temperature,
    })
  );

  const choice = response.choices[0];
  return {
    content: choice.message.content || '',
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    },
  };
}

async function callGeminiApiKey(
  apiKey: string,
  messages: Message[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

  // Extract system message and build contents
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const systemInstruction = systemParts.join('\n\n');

  const contents = chatMessages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature,
  };

  const requestConfig: Parameters<typeof model.generateContent>[0] = {
    contents,
    generationConfig,
  };

  if (systemInstruction) {
    (requestConfig as any).systemInstruction = systemInstruction;
  }

  const result = await _withRetry('gemini', () => model.generateContent(requestConfig));
  const response = result.response;
  const text = response.text();

  return {
    content: text,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    },
  };
}

async function callGeminiOAuth(
  accessToken: string,
  messages: Message[],
  options: CompletionOptions
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const MODEL = 'gemini-2.0-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  // Build system instruction and user/model contents
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const body: Record<string, unknown> = {
    contents: chatMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };

  if (systemParts.length > 0) {
    body.systemInstruction = {
      parts: [{ text: systemParts.join('\n\n') }],
    };
  }

  const data = await _withRetry('gemini-oauth', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      const e = new Error(`Gemini OAuth API error ${resp.status}: ${errText}`) as Error & { status?: number };
      e.status = resp.status;
      throw e;
    }

    return resp.json();
  }) as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';

  return {
    content: text,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount,
      outputTokens: data.usageMetadata?.candidatesTokenCount,
    },
  };
}

async function callGroq(
  apiKey: string,
  messages: Message[],
  options: CompletionOptions,
  model: string = 'llama-3.3-70b-versatile'
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
    maxRetries: 0,
    timeout: AI_TIMEOUT_MS,
  });

  const response = await _withRetry('groq', () =>
    client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: maxTokens,
      temperature,
    })
  );

  const choice = response.choices[0];
  return {
    content: choice.message.content || '',
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Session-based completion (primary path)
// ---------------------------------------------------------------------------

/**
 * Create a completion using credentials from the session.
 * The sessionData object is mutated in-place when access tokens are refreshed —
 * callers should ensure req.session is saved after this call if needed.
 */
export async function createCompletionFromSession(
  sessionData: { credentials?: SessionCredentials },
  messages: Message[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const creds = sessionData.credentials;
  if (!creds) throw new Error('No AI credentials in session');

  // Keyless free providers run on the server's shared Groq key.
  if (creds.provider === 'gemini-oauth' || creds.provider === 'groq-free') {
    const serverKey = config.ai.groqApiKey;
    if (!serverKey) {
      throw new Error('GROQ_API_KEY is not configured on the server. Set it in your .env file.');
    }
    const model =
      creds.provider === 'groq-free' && creds.model ? creds.model : 'llama-3.3-70b-versatile';
    return callGroq(serverKey, messages, options, model);
  }

  if (!creds.encryptedApiKey) {
    throw new Error(`Missing API key in session for provider "${creds.provider}"`);
  }

  const apiKey = decrypt(creds.encryptedApiKey);

  switch (creds.provider) {
    case 'claude':
      return callClaude(apiKey, messages, options);
    case 'openai':
      return callOpenAI(apiKey, messages, options);
    case 'gemini':
      return callGeminiApiKey(apiKey, messages, options);
    case 'groq':
      return callGroq(apiKey, messages, options);
    default:
      throw new Error(`Unknown provider: ${(creds as any).provider}`);
  }
}

// ---------------------------------------------------------------------------
// Env-based completion (backward compat / deprecated)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use createCompletionFromSession instead.
 * Reads API keys from environment variables. Kept for backward compatibility
 * when session credentials are not available.
 */
export async function createCompletion(
  messages: Message[],
  options: CompletionOptions = {}
): Promise<CompletionResult> {
  const { maxTokens = 4096, temperature = 0.3 } = options;
  const provider = config.ai.provider;

  if (provider === 'claude') {
    return _callAnthropic(messages, { maxTokens, temperature });
  } else if (provider === 'openai') {
    return _callOpenAI(messages, { maxTokens, temperature });
  } else {
    throw new Error(`Unknown AI provider: "${provider}". Set AI_PROVIDER to "claude" or "openai".`);
  }
}

async function _callAnthropic(
  messages: Message[],
  { maxTokens, temperature }: Required<CompletionOptions>
): Promise<CompletionResult> {
  const client = getAnthropicClient();

  let system = '';
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
    } else {
      anthropicMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
    }
  }

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.ai.anthropicModel,
    max_tokens: maxTokens,
    temperature,
    messages: anthropicMessages,
  };

  if (system) {
    params.system = system;
  }

  const response = await _withRetry('claude', () => client.messages.create(params));

  const content = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    content,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };
}

async function _callOpenAI(
  messages: Message[],
  { maxTokens, temperature }: Required<CompletionOptions>
): Promise<CompletionResult> {
  const client = getOpenAIClient();

  const response = await _withRetry('openai', () =>
    client.chat.completions.create({
      model: config.ai.openaiModel,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: maxTokens,
      temperature,
    })
  );

  const choice = response.choices[0];
  return {
    content: choice.message.content || '',
    usage: {
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Escape raw control characters (newlines, tabs, etc.) that appear *inside* JSON
 * string literals. Models frequently emit multi-line string values with literal
 * line breaks, which is invalid JSON — this repairs them so JSON.parse succeeds.
 */
function _escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && code < 0x20) {
      // Replace literal control chars with their JSON escape sequence.
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += '\\u' + code.toString(16).padStart(4, '0');
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Utility: parse JSON from AI response, stripping markdown fences if present.
 */
export function parseJsonResponse(text: string): unknown {
  // Strip ```json ... ``` or ``` ... ``` wrappers
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Narrow to the JSON body (first {/[ to last }/]) so prose around it is ignored.
  const start = Math.min(
    stripped.indexOf('{') === -1 ? Infinity : stripped.indexOf('{'),
    stripped.indexOf('[') === -1 ? Infinity : stripped.indexOf('[')
  );
  const end = Math.max(stripped.lastIndexOf('}'), stripped.lastIndexOf(']'));
  const body = start !== Infinity && end !== -1 ? stripped.slice(start, end + 1) : stripped;

  // Try strict, then narrowed, then control-char-repaired.
  const candidates = [stripped, body, _escapeControlCharsInStrings(body)];
  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `AI returned non-JSON response (${(lastErr as Error)?.message}): ${text.slice(0, 200)}`
  );
}
