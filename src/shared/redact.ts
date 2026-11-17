/** Mask what must not end up in a pasted bug report: e-mail addresses, tokens, auth headers and long secrets. */
export function redact(text: string): string {
  return text
    .replace(/discord(?:app)?\.com\/api\/webhooks\/[^\s"',;)]+/gi, 'discord.com/api/webhooks/[hidden]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b(bearer|basic)\s+[^\s"',;]+/gi, '$1 [hidden]')
    .replace(/(token|password|passwd|secret|authorization|cookie|apikey|api_key|session)(["'\s:=]+)[^\s"',;]+/gi, '$1$2[hidden]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hidden]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[hidden]');
}
