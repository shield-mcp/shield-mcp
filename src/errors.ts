const REDACTIONS: Array<[RegExp, string]> = [
  [/\b0x[0-9a-fA-F]{64}\b/g, '[redacted-private-key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, 'Bearer [redacted]'],
  [/([?&](?:api[_-]?key|token|access[_-]?token|auth|key)=)[^&\s]+/gi, '$1[redacted]'],
];

export function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return REDACTIONS.reduce((message, [pattern, replacement]) => message.replace(pattern, replacement), raw);
}
