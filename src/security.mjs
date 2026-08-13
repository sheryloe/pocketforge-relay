import crypto from 'node:crypto';
import path from 'node:path';
const PART = /^[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9._/-]{1,200}$/;

export function normalizeGitHubRepository(input) {
  if (typeof input !== 'string' || input.length > 500) throw new Error('Repository must be a GitHub HTTPS URL.');
  let url;
  try { url = new URL(input.trim()); } catch { throw new Error('Repository must be a valid URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('The MVP accepts public repositories from https://github.com only.');
  if (url.username || url.password || url.port || url.search || url.hash) throw new Error('Repository URLs cannot contain credentials, ports, queries, or fragments.');
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length !== 2) throw new Error('Repository URL must have the form https://github.com/owner/repository.');
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, '');
  if (!PART.test(owner) || !PART.test(repository)) throw new Error('Repository owner or name contains unsupported characters.');
  return `https://github.com/${owner}/${repository}.git`;
}
export function validateGitRef(input) {
  const ref = typeof input === 'string' && input.trim() ? input.trim() : 'main';
  if (!REF.test(ref) || ref.startsWith('-') || ref.startsWith('/') || ref.endsWith('/') || ref.includes('..') || ref.includes('@{') || ref.includes('//')) throw new Error('Git ref contains unsupported or unsafe characters.');
  return ref;
}
export function validateLabel(input) {
  if (input == null || input === '') return '';
  if (typeof input !== 'string') throw new Error('Label must be text.');
  const label = input.trim();
  if (label.length > 80) throw new Error('Label must be 80 characters or fewer.');
  return label;
}
export function tokenMatches(expected, header) {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = header.slice(7).trim();
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SECRET_ASSIGNMENT = /((?:^|[\s,{])["']?[A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const AUTHORIZATION_VALUE = /(\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?\s*(?:bearer|basic)\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;}\]]+)/gi;
const RECOGNIZED_TOKEN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;

export function createLogRedactor(secrets = []) {
  const exact = [...new Set(secrets.map(value => String(value ?? '')).filter(value => value.length >= 8))]
    .sort((a, b) => b.length - a.length);
  return (message) => {
    let redacted = String(message ?? '');
    for (const secret of exact) redacted = redacted.replaceAll(secret, '[REDACTED]');
    return redacted
      .replace(AUTHORIZATION_VALUE, '$1[REDACTED]')
      .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
      .replace(RECOGNIZED_TOKEN, '[REDACTED]');
  };
}
export function safeStaticPath(publicDir, requestPath) {
  let decoded; try { decoded = decodeURIComponent(requestPath); } catch { return null; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  const root = path.resolve(publicDir) + path.sep;
  return resolved === path.resolve(publicDir) || resolved.startsWith(root) ? resolved : null;
}
export function applySecurityHeaders(res, { api = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (api) res.setHeader('Cache-Control', 'no-store');
}
