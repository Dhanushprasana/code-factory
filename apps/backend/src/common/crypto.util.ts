import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_SALT = 'forgebench_secure_credential_salt';

function deriveKey(secret?: string): Buffer {
  const masterKey = secret || process.env.CREDENTIAL_ENCRYPTION_KEY || 'default-forgebench-insecure-master-key-32b';
  return scryptSync(masterKey, DEFAULT_SALT, 32);
}

export interface EncryptedData {
  encrypted: string;
  iv: string;
  tag: string;
  masked: string;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 6) return '••••••••';
  const prefix = apiKey.slice(0, Math.min(6, Math.floor(apiKey.length / 3)));
  const suffix = apiKey.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function encryptCredential(plaintext: string, secret?: string): EncryptedData {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag,
    masked: maskApiKey(plaintext),
  };
}

export function decryptCredential(encryptedHex: string, ivHex: string, tagHex: string, secret?: string): string {
  const key = deriveKey(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
