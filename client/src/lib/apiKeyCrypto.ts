/**
 * Zero-knowledge API key encryption for cloud sync.
 *
 * Security model:
 *   - Keys are encrypted entirely in the browser renderer using Web Crypto API.
 *   - The server stores only the opaque ciphertext; no plaintext is ever transmitted.
 *   - Key derivation: PBKDF2(password=accountToken, salt, 100_000 iters, SHA-256) → AES-256-GCM key
 *   - Encryption: AES-256-GCM with a random 12-byte IV per operation
 *   - Payload: JSON { salt, iv, ciphertext } with hex-encoded binary fields
 */

export interface ApiKeys {
  minimax_token?: string;
  anthropic_token?: string;
  glm_token?: string;
}

interface EncryptedPayload {
  salt: string;       // 32-byte hex
  iv: string;         // 12-byte hex
  ciphertext: string; // hex-encoded AES-GCM output
}

function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Explicit ArrayBuffer constructor ensures TypeScript infers Uint8Array<ArrayBuffer>,
// not Uint8Array<ArrayBufferLike>, so it satisfies the BufferSource constraint.
function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const buf = new ArrayBuffer(hex.length / 2);
  const out = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(n);
  const arr = new Uint8Array(buf);
  crypto.getRandomValues(arr);
  return arr;
}

async function deriveKey(accountToken: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(accountToken),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt API keys with the user's account token.
 * Returns a JSON string ready to be stored in D1.
 */
export async function encryptApiKeys(keys: ApiKeys, accountToken: string): Promise<string> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const aesKey = await deriveKey(accountToken, salt);

  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(keys));

  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    plaintext
  );

  const payload: EncryptedPayload = {
    salt: toHex(salt),
    iv: toHex(iv),
    ciphertext: toHex(new Uint8Array(ciphertextBuf)),
  };
  return JSON.stringify(payload);
}

/**
 * Decrypt an encrypted payload with the user's account token.
 * Throws if the token is wrong or the payload is malformed.
 */
export async function decryptApiKeys(blob: string, accountToken: string): Promise<ApiKeys> {
  const payload: EncryptedPayload = JSON.parse(blob);
  if (!payload.salt || !payload.iv || !payload.ciphertext) {
    throw new Error("Invalid encrypted payload");
  }

  const salt = fromHex(payload.salt);
  const iv = fromHex(payload.iv);
  const ciphertext = fromHex(payload.ciphertext);

  const aesKey = await deriveKey(accountToken, salt);

  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      ciphertext
    );
  } catch {
    throw new Error("Decryption failed — wrong token or corrupted data");
  }

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(plaintextBuf)) as ApiKeys;
}
