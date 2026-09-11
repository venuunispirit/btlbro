#!/usr/bin/env node

/**
 * Reset admin credentials to:
 *   Email: admin@btlbro.in
 *   Password: 1234
 * 
 * Usage: node server/reset-admin-password.mjs
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// Hash password using scrypt (same as auth.js)
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

// Read database
console.log('📖 Reading database...');
const dbRaw = fs.readFileSync(DB_PATH, 'utf8');
const db = JSON.parse(dbRaw);

// Find the admin user (id: 7, email: admin@btlbro.in)
const users = db.users || [];
const adminUser = users.find(u => u.id === 7 || u.email === 'admin@btlbro.in');

if (!adminUser) {
  console.error('❌ Admin user not found in database');
  process.exit(1);
}

console.log(`✅ Found admin user: ${adminUser.email} (${adminUser.name})`);

// Generate new password hash
const newPassword = '1234';
const { salt, hash } = hashPassword(newPassword);

// Update the user
adminUser.password_salt = salt;
adminUser.password_hash = hash;
adminUser.email = 'admin@btlbro.in';
adminUser.name = 'Admin';
adminUser.is_active = true;

// Write back to database
console.log('💾 Writing updated database...');
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log('✅ Admin credentials updated successfully!');
console.log('');
console.log('📧 Email:    admin@btlbro.in');
console.log('🔑 Password: 1234');
console.log('');
console.log('You can now log in to the admin panel at /admin');
