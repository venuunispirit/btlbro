// One-shot palette normalisation for the admin panel.
//
// The panel had drifted into a second, colder palette: generic greys (#999,
// #E0E0E0, #F0F0F0, #F5F5F5) had crept in tab by tab, so cards, borders and
// table headers did not match across the product. This maps every one of them
// onto the documented warm tokens in src/pages/admin/theme.js.
//
// It is context aware on purpose. #F0F0F0 is a border in one place and a card
// background in another, and those need different tokens, so each occurrence is
// classified by the CSS property it sits next to.
//
// WebsiteTab is excluded: it is out of scope for this pass.
//
//   node scripts/normalize-admin-colors.mjs [--check]
//
// --check reports what would change without writing.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TABS = path.join(__dirname, '..', 'src', 'pages', 'admin', 'tabs');
const COMPONENTS = path.join(__dirname, '..', 'src', 'pages', 'admin', 'components');
const ROOT = path.join(__dirname, '..', 'src', 'pages', 'admin');

const EXCLUDE = new Set(['WebsiteTab.jsx']);

// Text: three steps, mapped by how dark the original was.
const TEXT_MAP = {
  '#111': '#161616', '#1a1a1a': '#161616', '#141416': '#161616', '#333': '#161616',
  '#555': '#4A4A4A', '#666': '#4A4A4A', '#656565': '#4A4A4A', '#6b7280': '#4A4A4A',
  '#777': '#949494', '#7a7a7a': '#949494', '#888': '#949494',
  '#999': '#949494', '#9a9a9a': '#949494', '#9ca3af': '#949494',
  '#a3a3a3': '#949494', '#a6a6a6': '#949494', '#bdbdbd': '#B8AFA6',
};

// Lines.
const LINE_MAP = {
  '#e0e0e0': '#E7E2D8', '#e8e8e8': '#E7E2D8', '#eee': '#E7E2D8',
  // '#ededed' is deliberately absent: it is light text on a dark surface,
  // not a line, and flattening it to a border token would break contrast.
  '#ececec': '#F1EDE4', '#e7e7e7': '#F1EDE4',
  '#ccc': '#E7E2D8', '#ddd': '#C9C2B4', '#d1d5db': '#C9C2B4',
  '#f0f0f0': null,   // resolved by context: divider or sunken fill
};

// Fills: a light page, not a light grey.
const FILL_MAP = {
  '#f8f8f8': '#FAF9F7', '#fafafa': '#FAF9F7', '#f7f7f7': '#FAF9F7',
  '#f9f9f9': '#FAF9F7', '#f6f7f9': '#FAF9F7', '#f5f5f5': '#FAF9F7',
  '#f3f4f6': '#F3F0EA',
};

// Accent / status drift, so one orange and one green do not mean two things.
const ACCENT_MAP = {
  '#f2711c': '#F2701D', '#f97316': '#F2701D', '#e05e0f': '#C2410D',
  '#fff1e6': '#FFF4EC', '#fff6ef': '#FFF4EC', '#fff8f4': '#FFF4EC',
  '#fff8f3': '#FFF4EC', '#fff3e8': '#FFF4EC',
  '#16a34a': '#059669', '#15803d': '#059669', '#dcfce7': '#ECFDF5',
  '#ef4444': '#DC2626', '#c0392b': '#DC2626', '#991b1b': '#B91C1C',
  '#fff5f5': '#FEF2F2', '#fdecec': '#FEF2F2', '#f3c9c9': '#FECACA',
  '#3b82f6': '#2563EB', '#4f46e5': '#4F46E5', '#be185d': '#BE185D',
  '#f0fdf4': '#ECFDF5', '#dcefe7': '#ECFDF5',
};

const ALL = { ...TEXT_MAP, ...LINE_MAP, ...FILL_MAP, ...ACCENT_MAP };

/** Is this occurrence a border, a fill, or text? */
function classify(line, index) {
  const before = line.slice(0, index);
  if (/border[A-Za-z]*\s*[:=]\s*[^,]*$/.test(before)) return 'border';
  if (/background(Color)?\s*[:=]\s*[^,]*$/.test(before)) return 'fill';
  if (/outline[A-Za-z]*\s*[:=]\s*[^,]*$/.test(before)) return 'border';
  // `bg:` and `stroke="..."` are the same intents, spelled differently.
  if (/\bbg\s*[:=]\s*[^,]*$/.test(before)) return 'fill';
  if (/(fill|stroke)\s*[:=]\s*[^,]*$/.test(before)) return 'fill';
  if (/color\s*[:=]\s*[^,]*$/.test(before)) return 'text';
  return 'other';
}

/** Where each colour came from, so the rewrite is a judgement not a blind sed. */
function resolve(hex, kind) {
  const key = hex.toLowerCase();

  if (key === '#f0f0f0') {
    // The one genuinely context-dependent value: a soft hairline between rows
    // vs a recessed panel behind a control.
    return kind === 'fill' ? '#F4F1EA' : '#F1EDE4';
  }
  const has = (m, k) => Object.prototype.hasOwnProperty.call(m, k);

  // Text and accent mappings are semantic — they mean the same thing wherever
  // they appear, so they are tried first regardless of property.
  if (has(TEXT_MAP, key)) return TEXT_MAP[key];
  if (has(ACCENT_MAP, key)) return ACCENT_MAP[key];

  // Then the intent-specific maps, preferring the one that matches what the
  // property is actually doing.
  if (kind === 'border' && has(LINE_MAP, key)) return LINE_MAP[key] || '#E7E2D8';
  if (has(FILL_MAP, key)) return FILL_MAP[key];
  if (has(LINE_MAP, key)) return LINE_MAP[key] || '#E7E2D8';
  return null;
}

function targets() {
  const out = [];
  for (const dir of [TABS, COMPONENTS]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsx')) continue;
      if (EXCLUDE.has(f)) continue;
      out.push(path.join(dir, f));
    }
  }
  out.push(path.join(ROOT, 'AdminPanel.jsx'));
  return out.filter((f) => fs.existsSync(f));
}

const checkOnly = process.argv.includes('--check');
let totalChanged = 0;
const perFile = [];

for (const file of targets()) {
  const src = fs.readFileSync(file, 'utf8');
  const counts = new Map();
  // Replace per line so context can be judged from the surrounding CSS property.
  const lines = src.split('\n');
  const out = lines.map((line) => {
    let next = line;
    // Longest keys first, so #f0f0f0 is not eaten by a #f0 prefix rule.
    for (const hex of Object.keys(ALL).sort((a, b) => b.length - a.length)) {
      // Match the hex wherever it sits, not only when it is the whole string
      // value: '1px solid #E0E0E0' is a border just as much as '#E0E0E0' is.
      // The lookahead stops the 3-digit keys from biting into a 6-digit value.
      const re = new RegExp(hex + '(?![0-9A-Fa-f])', 'gi');
      next = next.replace(re, (match, offset) => {
        const kind = classify(next, offset);
        const to = resolve(match, kind);
        if (!to) return match;
        if (to.toLowerCase() === match.toLowerCase()) return match;
        counts.set(to, (counts.get(to) || 0) + 1);
        return to;
      });
    }
    return next;
  });
  const result = out.join('\n');
  if (result !== src) {
    totalChanged += [...counts.values()].reduce((a, b) => a + b, 0);
    perFile.push({ file: path.basename(file), n: [...counts.values()].reduce((a, b) => a + b, 0) });
    if (!checkOnly) fs.writeFileSync(file, result);
  }
}

perFile.sort((a, b) => b.n - a.n);
for (const f of perFile) console.log(`  ${String(f.n).padStart(4)}  ${f.file}`);
console.log(`\n${checkOnly ? 'would change' : 'changed'} ${totalChanged} colour(s) across ${perFile.length} file(s)`);
console.log(`skipped: ${[...EXCLUDE].join(', ')}`);
