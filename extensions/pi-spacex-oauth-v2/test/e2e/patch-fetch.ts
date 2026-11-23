// Points the Grok Build hosts at the local fake server. Loaded with `-e` after Pi has wrapped fetch.
const GROK_HOSTS = new Set(['auth.x.ai', 'cli-chat-proxy.grok.com']);
const realFetch = globalThis.fetch;

export default function patchGrokFetch(): void {
  const base = process.env['E2E_GROK_BASE'];
  if (!base) throw new Error('E2E_GROK_BASE is not set');
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!GROK_HOSTS.has(url.hostname)) return realFetch(input, init);
    return realFetch(`${base}${url.pathname}${url.search}`, init);
  };
}
