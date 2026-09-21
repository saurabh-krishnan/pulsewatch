/**
 * Error fingerprinting (guide 7.3).
 *
 * Normalize the variable parts of an error message away, then hash
 * `errorType|normalized`. Same hash means the same underlying problem.
 */
import { createHash } from 'node:crypto';

// Order matters: specific patterns first, generic numbers last.
const RULES: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?/gi, '<ts>'],
  [/https?:\/\/[^\s"'<>]+/gi, '<url>'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>'],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b[0-9a-f]{16,}\b/gi, '<hex>'],
  [/\d+/g, '<num>'],
];

export function normalize(message: string): string {
  let s = message.toLowerCase();
  for (const [pattern, token] of RULES) s = s.replace(pattern, token);
  return s.replace(/\s+/g, ' ').trim();
}

export function fingerprint(errorType: string, message: string): string {
  return createHash('sha256').update(`${errorType}|${normalize(message)}`).digest('hex');
}
