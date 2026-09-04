const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export function validateWebhookUrl(value) {
  const trimmedUrl = value?.trim();
  if (!trimmedUrl) throw new Error('Webhook 地址不能为空');

  let parsed;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new Error('Webhook 地址格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Webhook 地址只支持 http 或 https');
  }
  return trimmedUrl;
}

async function readResponseBody(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body?.getReader) {
    const source = typeof response.text === 'function' ? await response.text() : '';
    const bytes = new TextEncoder().encode(source);
    return {
      body: new TextDecoder().decode(bytes.subarray(0, maxBytes)),
      truncated: bytes.byteLength > maxBytes,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let receivedBytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remainingBytes = maxBytes - receivedBytes;
    if (remainingBytes <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    const chunk = value.byteLength > remainingBytes ? value.subarray(0, remainingBytes) : value;
    body += decoder.decode(chunk, { stream: true });
    receivedBytes += chunk.byteLength;
    if (chunk.byteLength < value.byteLength) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  body += decoder.decode();
  return { body, truncated };
}

export async function triggerWebhook(webhook, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = validateWebhookUrl(webhook?.url);
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持发送 Webhook 请求');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const responseBody = await readResponseBody(response);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      contentType: response.headers?.get?.('content-type') || '',
      body: responseBody.body,
      truncated: responseBody.truncated,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Webhook 请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    if (String(error?.message || '').startsWith('Webhook ')) throw error;
    const reason = error?.cause?.code || error?.cause?.message || error?.message || String(error);
    throw new Error(`Webhook 请求失败：${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}
