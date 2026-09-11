// First-run bootstrap: guarantee at least one Super Admin exists so the
// (previously hardcoded) admin login can be replaced by real staff accounts.
//
// 1. If ADMIN_EMAIL / ADMIN_PASSWORD are set in .env → upsert that account.
// 2. Otherwise the server runs without a super admin until one is created,
//    and the console hints at how to add ADMIN_EMAIL/ADMIN_PASSWORD.

import crypto from 'crypto';
import { dbHelpers } from './db.js';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function ensureSuperAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email || !password) return null;

  const existing = dbHelpers.getUserByEmail(email);
  if (existing) return existing;

  const { salt, hash } = hashPassword(password);
  return dbHelpers.addUser({
    name: 'Super Admin',
    email,
    password_salt: salt,
    password_hash: hash,
    phone: '',
    designation: 'Super Admin',
    role: 'super_admin',
    is_team: true,
  });
}