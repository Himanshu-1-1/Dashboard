#!/usr/bin/env node
// Locks the published dashboard data behind the shared passcode (GitHub Actions secret DASH_PASSCODE).
//
//   DASH_PASSCODE=... node scripts/lock_site.mjs site
//
// Reads site/data.js and, when present, site/boxbyte.js, site/courier.js, site/research.js, site/mail.js, site/cal.js, site/ff.js,
// site/linksync.js and site/p3.js (each sets one window.__NAME__ = {...}), plus any site/*.sealed.json written by scripts/seal.mjs (opened with the MAIL_KEY
// secret, the RSA private key, and served to the page as window.__SEALED__.datasets), encrypts them together with
// AES-256-GCM under a key derived from the passcode (PBKDF2-SHA256), writes site/data.lock.json, deletes the readable files and removes their <script> tags from
// site/index.html. The page decrypts in the browser after the passcode is entered. A sealed file may also carry `lazy` parts
// (name -> base64 gzip of JSON, for example the Chief of Staff feed): each is written as its own <name>.lock.json under the same
// passcode key, listed in the bundle as window.__LAZY__, and fetched by the page only when a tab asks for it (CC_LAZY).
// Node standard library only.
import { constants, createCipheriv, createDecipheriv, createPrivateKey, pbkdf2Sync, privateDecrypt, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const KDF = { name: 'PBKDF2-SHA256', iterations: 600000, salt: 'campaign-command-center|Himanshu-1-1/Dashboard|v1' };
const FILES = ['data.js', 'boxbyte.js', 'courier.js', 'research.js', 'mail.js', 'cal.js', 'ff.js', 'linksync.js', 'p3.js'];
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
let lazyParts = {};
for (const name of FILES) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    if (name === 'data.js') fail('site/data.js is missing; nothing to lock.');
    continue;
  }
  const text = readFileSync(path, 'utf8');
  const m = /^\s*window\.(__[A-Z0-9_]+__)\s*=\s*([\s\S]*?);?\s*$/.exec(text);
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
    const lazy = {};
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
        for (const [name, b64] of Object.entries(opened.lazy || {})) {
          if (!/^[a-z][a-z0-9_]{1,40}$/.test(name)) fail(`lazy part name ${JSON.stringify(name)} in ${f} is not allowed`);
          if (lazy[name]) fail(`lazy part ${name} appears in more than one sealed file`);
          lazy[name] = Buffer.from(String(b64), 'base64');
        }
        console.log(`Opened ${f}: ${[...Object.keys(opened.datasets || {}), ...Object.keys(opened.lazy || {}).map((n) => n + ' (lazy)')].join(', ')} (sealed ${opened.sealed_at || 'at an unknown time'}).`);
      } catch (err) {
        console.log(`::warning::${f} could not be opened (${err.message}); the site goes out without it.`);
      }
    }
    if (Object.keys(sealed).length) bundle.__SEALED__ = { datasets: sealed };
    lazyParts = lazy;
  }
}

const key = pbkdf2Sync(Buffer.from(passcode, 'utf8'), Buffer.from(KDF.salt, 'utf8'), KDF.iterations, 32, 'sha256');
/* Lazy parts: gzip bytes encrypted under the passcode key, one file each; the page fetches, decrypts and gunzips on demand. */
const lazyFiles = {};
for (const [name, gz] of Object.entries(lazyParts)) {
  const liv = randomBytes(12);
  const lc = createCipheriv('aes-256-gcm', key, liv);
  const enc = Buffer.concat([lc.update(gz), lc.final(), lc.getAuthTag()]);
  const file = `${name}.lock.json`;
  writeFileSync(join(dir, file), JSON.stringify({ v: 1, enc: 'gzip-json', iv: liv.toString('base64'), data: enc.toString('base64') }));
  lazyFiles[name] = file;
  console.log(`Locked lazy part ${name} into ${file} (${enc.length} bytes).`);
}
if (Object.keys(lazyFiles).length) bundle.__LAZY__ = lazyFiles;
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
const stripped = html.replace(/^[ \t]*<script src="(?:data|boxbyte|courier|research|mail|cal|ff|linksync|p3)\.js"><\/script>\r?\n/gm, '');
writeFileSync(indexPath, stripped);
const left = FILES.filter((f) => stripped.includes(`src="${f}"`));
if (left.length) fail('index.html still loads ' + left.join(', '));
console.log(`Locked ${Object.keys(bundle).join(', ')} into data.lock.json (${body.length} bytes).`);
