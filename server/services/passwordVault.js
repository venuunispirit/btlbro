// Reversible password storage — powers "show me this member's password".
//
// Login NEVER touches this file: auth still verifies against the scrypt hash.
// The vault exists so the owner of this install can read a staff password
// instead of resetting it when someone is locked out.
//
// Key handling — the ciphertext lives in db.json, the key does not:
//   1. PASSWORD_VAULT_KEY env var (sha256 of it becomes the 32-byte key), else
//   2. an auto-generated server/data/.vault-key file (gitignored, mode 600).
// Sharing or committing db.json therefore does not expose any password.
//
// If the key is ever lost/rotated, decryptPassword() returns null for old
// rows: login keeps working off the hash, and resetting a password restores
// recoverability for that member. Never throws into a route.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1';
const KEY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '.vault-key');

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = String(process.env.PASSWORD_VAULT_KEY || '').trim();
  if (fromEnv) {
    cachedKey = crypto.createHash('sha256').update(fromEnv, 'utf8').digest();
    return cachedKey;
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
      if (key.length === 32) {
        cachedKey = key;
        return cachedKey;
      }
    }
  } catch {
    // fall through and mint a fresh key below
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  cachedKey = key;
  return cachedKey;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>` (all base64). */
export function encryptPassword(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

/** Plaintext, or null when missing/foreign/tampered/key-rotated. */
export function decryptPassword(blob) {
  try {
    if (!blob) return null;
    const [version, ivB64, tagB64, ctB64] = String(blob).split('.');
    if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
