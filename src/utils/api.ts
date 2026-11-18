export async function safeParseJsonResponse<T = unknown>(res: Response): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();

  if (trimmed.startsWith('<')) {
    throw new Error(
      `服务端返回了非 JSON 页面（HTTP ${res.status}），可能是上传文件超出网关体积限制、服务正在重启或接口未就绪，请刷新页面或拆分较小文件后重试。`
    );
  }

  let data: unknown;
  try {
    data = trimmed ? JSON.parse(trimmed) : {};
  } catch {
    throw new Error(`无法解析服务端响应（HTTP ${res.status}）：${trimmed.slice(0, 120)}`);
  }

  if (!res.ok) {
    const errMsg =
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${res.status}）`;
    throw new Error(errMsg);
  }

  return data as T;
}

export async function consumeNdjsonStream<T>(
  res: Response,
  onEvent: (event: T) => void
): Promise<void> {
  if (!res.ok) {
    await safeParseJsonResponse(res);
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }

  if (!res.body) {
    const data = await safeParseJsonResponse<T>(res);
    onEvent(data);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        if (line.startsWith('<')) {
          throw new Error('服务端返回了非 JSON 响应流，请重试。');
        }
        onEvent(JSON.parse(line) as T);
      }
      newlineIndex = buffer.indexOf('\n');
    }
  }

  const remaining = (buffer + decoder.decode()).trim();
  if (remaining) {
    if (remaining.startsWith('<')) {
      throw new Error('服务端返回了非 JSON 响应流，请重试。');
    }
    onEvent(JSON.parse(remaining) as T);
  }
}
