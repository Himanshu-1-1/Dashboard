#!/usr/bin/env node
// Locks the published dashboard data behind the shared passcode (GitHub Actions secret DASH_PASSCODE).
//
//   DASH_PASSCODE=... node scripts/lock_site.mjs site
//
// Reads site/data.js and, when present, site/boxbyte.js, site/courier.js and site/research.js (each sets one
// window.__NAME__ = {...}), encrypts them together with AES-256-GCM under a key derived from the passcode
// (PBKDF2-SHA256), writes site/data.lock.json, deletes the readable files and removes their <script> tags from
// site/index.html. The page decrypts in the browser after the passcode is entered. Node standard library only.
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KDF = { name: 'PBKDF2-SHA256', iterations: 600000, salt: 'campaign-command-center|Himanshu-1-1/Dashboard|v1' };
const FILES = ['data.js', 'boxbyte.js', 'courier.js', 'research.js'];
const MIN_LENGTH = 16;

const fail = (msg) => {
  console.error('::error::' + msg);
  process.exit(1);
};

const dir = process.argv[2];
if (!dir) fail('usage: node scripts/lock_site.mjs <site dir>');
const passcode = process.env.DASH_PASSCODE || '';
if (!passcode) fail('DASH_PASSCODE is not set. Add it as a GitHub Actions secret; the site is not published without it.');
if ([...passcode].length < MIN_LENGTH) fail(`DASH_PASSCODE must be at least ${MIN_LENGTH} characters.`);

const bundle = {};
for (const name of FILES) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    if (name === 'data.js') fail('site/data.js is missing; nothing to lock.');
    continue;
  }
  const text = readFileSync(path, 'utf8');
  const m = /^\s*window\.(__[A-Z_]+__)\s*=\s*([\s\S]*?);?\s*$/.exec(text);
  if (!m) fail(`${name} is not in the form window.__NAME__ = {...};`);
  try {
    bundle[m[1]] = JSON.parse(m[2]);
  } catch (err) {
    fail(`${name} does not hold valid JSON: ${err.message}`);
  }
}

const key = pbkdf2Sync(Buffer.from(passcode, 'utf8'), Buffer.from(KDF.salt, 'utf8'), KDF.iterations, 32, 'sha256');
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const body = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final(), cipher.getAuthTag()]);
writeFileSync(join(dir, 'data.lock.json'), JSON.stringify({
  v: 1, kdf: KDF.name, iterations: KDF.iterations, salt: Buffer.from(KDF.salt, 'utf8').toString('base64'),
  iv: iv.toString('base64'), data: body.toString('base64'),
}));

for (const name of FILES) rmSync(join(dir, name), { force: true });
const indexPath = join(dir, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const stripped = html.replace(/^[ \t]*<script src="(?:data|boxbyte|courier|research)\.js"><\/script>\r?\n/gm, '');
writeFileSync(indexPath, stripped);
const left = FILES.filter((f) => stripped.includes(`src="${f}"`));
if (left.length) fail('index.html still loads ' + left.join(', '));
console.log(`Locked ${Object.keys(bundle).join(', ')} into data.lock.json (${body.length} bytes).`);
