export async function safeFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const resp = await fetch(input, init);
  const raw = await resp.text();
  let parsed: Record<string, unknown> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const snippet = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      parsed = {
        error: resp.ok
          ? 'Server returned an unexpected non-JSON response.'
          : `Request failed (HTTP ${resp.status})${snippet ? `: ${snippet}` : ''}`,
      };
    }
  }
  return {
    ok: resp.ok,
    status: resp.status,
    data: parsed as T & { error?: string },
  };
}
