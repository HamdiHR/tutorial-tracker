// Synchronous SHA-1 (the engine hashes drift text with it; must equal Node's output) + random helpers.
function sha1(bytes) {
  const l = bytes.length, words = [];
  for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
  words[(((l + 8) >> 6) + 1) * 16 - 1] = l * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const rol = (n, s) => (n << s) | (n >>> (32 - s));
  for (let i = 0; i < words.length; i += 16) {
    const w = new Array(80);
    for (let t = 0; t < 80; t++) w[t] = t < 16 ? words[i + t] | 0 : rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const [f, k] = t < 20 ? [(b & c) | (~b & d), 0x5a827999] : t < 40 ? [b ^ c ^ d, 0x6ed9eba1] : t < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const tmp = (rol(a, 5) + f + e + k + w[t]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
export function createHash(alg) {
  if (alg !== 'sha1') throw new Error('only sha1 is shimmed');
  let buf = '';
  return { update(s) { buf += s; return this; }, digest() { return sha1(new TextEncoder().encode(buf)); } };
}
export function randomBytes(n) { const b = crypto.getRandomValues(new Uint8Array(n)); return { toString: () => [...b].map((x) => x.toString(16).padStart(2, '0')).join('') }; }
export const randomUUID = () => crypto.randomUUID();
export default { createHash, randomBytes, randomUUID };
