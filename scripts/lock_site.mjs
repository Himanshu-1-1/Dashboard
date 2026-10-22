#!/usr/bin/env node
// Locks the published dashboard data behind the shared passcode (GitHub Actions secret DASH_PASSCODE).
//
//   DASH_PASSCODE=... node scripts/lock_site.mjs site
//
// Reads site/data.js and, when present, site/boxbyte.js, site/courier.js, site/research.js, site/mail.js, site/cal.js, site/ff.js and
// site/linksync.js (each sets one window.__NAME__ = {...}), plus any site/*.sealed.json written by scripts/seal.mjs (opened with the MAIL_KEY
// secret, the RSA private key, and served to the page as window.__SEALED__.datasets), encrypts them together with
// AES-256-GCM under a key derived from the passcode (PBKDF2-SHA256), writes site/data.lock.json, deletes the readable files and removes their <script> tags from
// site/index.html. The page decrypts in the browser after the passcode is entered. Node standard library only.
import { constants, createCipheriv, createDecipheriv, createPrivateKey, pbkdf2Sync, privateDecrypt, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KDF = { name: 'PBKDF2-SHA256', iterations: 600000, salt: 'campaign-command-center|Himanshu-1-1/Dashboard|v1' };
const FILES = ['data.js', 'boxbyte.js', 'courier.js', 'research.js', 'mail.js', 'cal.js', 'ff.js', 'linksync.js'];
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

const sealedFiles = readdirSync(dir).filter((f) => f.endsWith('.sealed.json'));
if (sealedFiles.length) {
  const pem = process.env.MAIL_KEY || '';
  if (!pem) {
    console.log(`::warning::MAIL_KEY is not set, so ${sealedFiles.join(', ')} can't be opened; the site goes out without them.`);
  } else {
    let privateKey;
    try {
      privateKey = createPrivateKey(pem);
    } catch (err) {
      fail(`MAIL_KEY is not a valid private key: ${err.message}`);
    }
    const sealed = {};
    for (const f of sealedFiles) {
      try {
        const box = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (box.v !== 1 || box.alg !== 'RSA-OAEP-256+A256GCM') throw new Error('unknown format');
        const dataKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(box.key, 'base64'));
        const raw = Buffer.from(box.data, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(box.iv, 'base64'));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        const opened = JSON.parse(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8'));
        for (const [name, rows] of Object.entries(opened.datasets || {})) {
          if (sealed[name]) fail(`dataset ${name} appears in more than one sealed file`);
          sealed[name] = rows;
        }
        console.log(`Opened ${f}: ${Object.keys(opened.datasets || {}).join(', ')} (sealed ${opened.sealed_at || 'at an unknown time'}).`);
      } catch (err) {
        console.log(`::warning::${f} could not be opened (${err.message}); the site goes out without it.`);
      }
    }
    if (Object.keys(sealed).length) bundle.__SEALED__ = { datasets: sealed };
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

for (const name of [...FILES, ...sealedFiles]) rmSync(join(dir, name), { force: true });
const indexPath = join(dir, 'index.html');
const html = readFileSync(indexPath, 'utf8');
const stripped = html.replace(/^[ \t]*<script src="(?:data|boxbyte|courier|research|mail|cal|ff|linksync)\.js"><\/script>\r?\n/gm, '');
writeFileSync(indexPath, stripped);
const left = FILES.filter((f) => stripped.includes(`src="${f}"`));
if (left.length) fail('index.html still loads ' + left.join(', '));
console.log(`Locked ${Object.keys(bundle).join(', ')} into data.lock.json (${body.length} bytes).`);
