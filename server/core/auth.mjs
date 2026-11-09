// Passwords (PBKDF2-SHA256), session tokens, and verification of Google / Apple ID tokens against the
// providers' published signing keys (RS256). Web Crypto only, so it runs in Node and on Cloudflare Workers.
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const PBKDF2_ITERATIONS = 100000; // Workers cap PBKDF2 at 100k iterations

export const PROVIDERS = {
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { issuers: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys' }
};

function randomBytes(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }
export function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); }
function unhex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export function b64url(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await pbkdf2(String(password), salt, PBKDF2_ITERATIONS);
  return 'pbkdf2$' + PBKDF2_ITERATIONS + '$' + hex(salt) + '$' + hex(key);
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 1000000) return false;
  try {
    const key = await pbkdf2(String(password || ''), unhex(parts[2]), iterations);
    return equal(key, unhex(parts[3]));
  } catch (e) { return false; }
}

export function newToken(bytes = 32) { return hex(randomBytes(bytes)); }

// ---------------------------------------------------------------- ID tokens (OpenID Connect)
export class JwksCache {
  constructor(url, fetchImpl) {
    this.url = url;
    this.fetch = fetchImpl || ((u) => fetch(u));
    this.keys = null;
    this.fetched = 0;
  }
  async key(kid, force) {
    const stale = Date.now() - this.fetched > 60 * 60 * 1000;
    if (!this.keys || stale || force) {
      const res = await this.fetch(this.url);
      if (!res.ok) throw new Error('jwks fetch failed: ' + res.status);
      const body = await res.json();
      this.keys = body.keys || [];
      this.fetched = Date.now();
    }
    return this.keys.find((k) => k.kid === kid) || null;
  }
}

// Verifies signature, issuer, audience and expiry. Returns the payload (sub, email, name...) or throws.
export async function verifyIdToken(token, { issuers, audience, jwks, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const decoder = new TextDecoder();
  const header = JSON.parse(decoder.decode(b64url(parts[0])));
  const payload = JSON.parse(decoder.decode(b64url(parts[1])));
  if (header.alg !== 'RS256') throw new Error('unsupported algorithm ' + header.alg);
  let jwk = await jwks.key(header.kid);
  if (!jwk) jwk = await jwks.key(header.kid, true); // keys rotate: refetch once
  if (!jwk || jwk.kty !== 'RSA') throw new Error('unknown signing key');
  const key = await subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  if (!issuers.includes(payload.iss)) throw new Error('wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw new Error('wrong audience');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now - 60 * 1000) throw new Error('token expired');
  if (!payload.sub) throw new Error('no subject');
  return payload;
}

// One verifier per configured provider: { google: (token) => payload, apple: (token) => payload }.
export function makeVerifiers(config, fetchImpl) {
  const out = {};
  if (config.googleClientId) {
    const cache = new JwksCache(PROVIDERS.google.jwks, fetchImpl);
    out.google = (token) => verifyIdToken(token, { issuers: PROVIDERS.google.issuers, audience: config.googleClientId, jwks: cache });
  }
  if (config.appleClientId) {
    const cache = new JwksCache(PROVIDERS.apple.jwks, fetchImpl);
    out.apple = (token) => verifyIdToken(token, { issuers: PROVIDERS.apple.issuers, audience: config.appleClientId, jwks: cache });
  }
  return out;
}
