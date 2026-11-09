// Password hashing, tokens, and Google/Apple-style ID token verification with locally generated keys.
import { hashPassword, verifyPassword, newToken, verifyIdToken, JwksCache, makeVerifiers, PROVIDERS } from '../server/core/auth.mjs';
import { suite } from './harness.mjs';

const t = suite('auth');
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Passwords
const stored = await hashPassword('secret123');
t.check(stored.startsWith('pbkdf2$100000$'), 'passwords are stored as PBKDF2 hashes');
t.check(await verifyPassword('secret123', stored), 'correct password verifies');
t.check(!(await verifyPassword('secret124', stored)), 'wrong password fails');
t.check(!(await verifyPassword('secret123', 'garbage')), 'garbage hash fails');
t.check((await hashPassword('secret123')) !== stored, 'salts differ between hashes');
t.check(/^[0-9a-f]{64}$/.test(newToken()) && newToken() !== newToken(), 'tokens are 32 random bytes');

// ID tokens: sign with our own RSA key and publish it as a JWKS
const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await subtle.exportKey('jwk', pair.publicKey);
const KID = 'test-key-1';
const jwks = { keys: [{ kty: 'RSA', kid: KID, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] };
let fetches = 0;
const fakeFetch = async () => { fetches++; return { ok: true, json: async () => jwks }; };
async function sign(payload, kid = KID) {
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(header + '.' + body));
  return header + '.' + body + '.' + b64url(new Uint8Array(sig));
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: 'https://accounts.google.com', aud: 'my-client-id', sub: '1234567890', email: 'player@example.com', name: 'Player One', exp: now + 3600, iat: now };
const cache = new JwksCache('https://example.test/certs', fakeFetch);
const opts = { issuers: PROVIDERS.google.issuers, audience: 'my-client-id', jwks: cache };

const payload = await verifyIdToken(await sign(good), opts);
t.equal(payload.sub, '1234567890', 'a valid Google-style token verifies and returns its subject');
t.equal(payload.email, 'player@example.com', 'email comes back from the token');
await verifyIdToken(await sign(good), opts);
t.equal(fetches, 1, 'signing keys are cached between verifications');

async function rejects(token, what) {
  try { await verifyIdToken(token, opts); t.check(false, what + ' is rejected'); }
  catch (e) { t.check(true, what + ' is rejected (' + e.message + ')'); }
}
await rejects(await sign(Object.assign({}, good, { aud: 'other-client' })), 'wrong audience');
await rejects(await sign(Object.assign({}, good, { iss: 'https://evil.example' })), 'wrong issuer');
await rejects(await sign(Object.assign({}, good, { exp: now - 3600 })), 'expired token');
const tampered = (await sign(good)).split('.');
tampered[1] = b64url(enc.encode(JSON.stringify(Object.assign({}, good, { sub: 'someone-else' }))));
await rejects(tampered.join('.'), 'tampered payload');
await rejects(await sign(good, 'unknown-kid'), 'unknown signing key');
await rejects('not.a.jwt.at.all', 'malformed token');
t.check(fetches >= 2, 'an unknown key id triggers one refetch of the key set');

const apple = await verifyIdToken(await sign({ iss: 'https://appleid.apple.com', aud: 'com.example.warz', sub: 'apple-user', exp: now + 600 }),
  { issuers: PROVIDERS.apple.issuers, audience: 'com.example.warz', jwks: new JwksCache('x', fakeFetch) });
t.equal(apple.sub, 'apple-user', 'Apple-style tokens use the same path with Apple issuer and audience');

t.equal(Object.keys(makeVerifiers({}, fakeFetch)).length, 0, 'no verifiers without client ids');
t.equal(Object.keys(makeVerifiers({ googleClientId: 'g', appleClientId: 'a' }, fakeFetch)).sort().join(), 'apple,google', 'verifiers exist for configured providers');

t.done();
