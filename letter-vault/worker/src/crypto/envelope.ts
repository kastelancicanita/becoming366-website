/**
 * Envelope encryption: AES-256-GCM per payload, DEK wrapped with master key.
 * Uses Web Crypto (Workers + modern Node for tests).
 */

export const MASTER_KEY_VERSION = "v1";

export interface EncryptedEnvelope {
  ciphertext_b64: string;
  ciphertext_nonce_b64: string;
  wrapped_dek_b64: string;
  wrap_nonce_b64: string;
  master_key_version: string;
  content_hash: string;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function importMasterKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64ToBytes(base64Key);
  if (raw.length !== 32) {
    throw new Error("master_key_invalid_length");
  }
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function generateDek(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  if (key instanceof CryptoKey) {
    return key;
  }
  throw new Error("dek_generation_failed");
}

async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext,
  );
  return { ciphertext: new Uint8Array(ciphertext), nonce };
}

async function aesGcmDecrypt(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertext,
  );
  return new Uint8Array(plaintext);
}

export async function encryptPayload(
  masterKeyB64: string,
  plaintextUtf8: string,
): Promise<EncryptedEnvelope> {
  const masterKey = await importMasterKey(masterKeyB64);
  const dek = await generateDek();
  const plaintextBytes = new TextEncoder().encode(plaintextUtf8);

  const { ciphertext, nonce: ciphertextNonce } = await aesGcmEncrypt(
    dek,
    plaintextBytes,
  );

  const dekRawBuffer = await crypto.subtle.exportKey("raw", dek);
  const dekRaw = new Uint8Array(dekRawBuffer as ArrayBuffer);
  const { ciphertext: wrappedDek, nonce: wrapNonce } = await aesGcmEncrypt(
    masterKey,
    dekRaw,
  );

  return {
    ciphertext_b64: bytesToB64(ciphertext),
    ciphertext_nonce_b64: bytesToB64(ciphertextNonce),
    wrapped_dek_b64: bytesToB64(wrappedDek),
    wrap_nonce_b64: bytesToB64(wrapNonce),
    master_key_version: MASTER_KEY_VERSION,
    content_hash: await sha256Hex(plaintextBytes),
  };
}

export async function decryptPayload(
  masterKeyB64: string,
  envelope: Pick<
    EncryptedEnvelope,
    | "ciphertext_b64"
    | "ciphertext_nonce_b64"
    | "wrapped_dek_b64"
    | "wrap_nonce_b64"
    | "master_key_version"
  >,
): Promise<Uint8Array> {
  if (envelope.master_key_version !== MASTER_KEY_VERSION) {
    throw new Error("unsupported_master_key_version");
  }

  const masterKey = await importMasterKey(masterKeyB64);
  const dekRaw = await aesGcmDecrypt(
    masterKey,
    b64ToBytes(envelope.wrapped_dek_b64),
    b64ToBytes(envelope.wrap_nonce_b64),
  );

  const dek = await crypto.subtle.importKey(
    "raw",
    dekRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  return aesGcmDecrypt(
    dek,
    b64ToBytes(envelope.ciphertext_b64),
    b64ToBytes(envelope.ciphertext_nonce_b64),
  );
}

export async function verifyEnvelope(
  masterKeyB64: string,
  envelope: EncryptedEnvelope,
): Promise<boolean> {
  const plaintext = await decryptPayload(masterKeyB64, envelope);
  const hash = await sha256Hex(plaintext);
  return hash === envelope.content_hash;
}
