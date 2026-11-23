export function normalizeOllamaBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Ollama Base URL is required.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid Ollama Base URL. Example: http://127.0.0.1:11434');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Ollama Base URL must use http:// or https://');
  }
  return parsed.toString().replace(/\/+$/, '');
}

export async function testOllamaConnection(baseUrl: string): Promise<{
  ok: boolean;
  baseUrl: string;
  models: string[];
  error?: string;
}> {
  let cleanUrl = '';
  try {
    cleanUrl = normalizeOllamaBaseUrl(baseUrl);
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      models: [],
      error: err instanceof Error ? err.message : 'Invalid Ollama URL',
    };
  }

  try {
    const res = await fetch(`${cleanUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        ok: false,
        baseUrl: cleanUrl,
        models: [],
        error: `Ollama returned HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const models = (data.models || [])
      .map((m) => m.name || m.model || '')
      .filter(Boolean);
    return { ok: true, baseUrl: cleanUrl, models };
  } catch (err) {
    return {
      ok: false,
      baseUrl: cleanUrl,
      models: [],
      error:
        err instanceof Error
          ? `Could not connect to Ollama at ${cleanUrl}: ${err.message}`
          : 'Connection failed',
    };
  }
}

export function extractJsonFromLlmText(rawText: string): string {
  // Strip Qwen/DeepSeek <think>...</think> blocks and markdown fences if present
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export async function generateOllamaJson<T>(params: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  const cleanUrl = normalizeOllamaBaseUrl(params.baseUrl);
  const res = await fetch(`${cleanUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: params.model,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
        num_ctx: 8192,
      },
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama error (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    message?: { content?: string };
    response?: string;
  };
  const content = data.message?.content ?? data.response ?? '';
  if (!content.trim()) {
    throw new Error('Ollama returned an empty response.');
  }

  const jsonStr = extractJsonFromLlmText(content);
  return JSON.parse(jsonStr) as T;
}
