#!/usr/bin/env node
// Seals private datasets so they can sit on a public branch until the site build unseals them.
//
//   node scripts/seal.mjs scripts/seal_key.pub.pem out.sealed.json b2b_mail=b2b_mail.json b2b_mail_weeks=weeks.json
//
// Each name=path pair becomes one dataset in the sealed bundle. The bundle is encrypted with a fresh AES-256-GCM
// key, and that key is wrapped with the RSA public key (RSA-OAEP, SHA-256). Only the build, which holds the private
// key as the MAIL_KEY secret, can open it (scripts/lock_site.mjs). Node standard library only.
import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const fail = (msg) => {
  console.error('::error::' + msg);
  process.exit(1);
};

const [pubPath, outPath, ...pairs] = process.argv.slice(2);
if (!pubPath || !outPath || !pairs.length) fail('usage: node scripts/seal.mjs <public key .pem> <out.sealed.json> name=file.json ...');

let publicKey;
try {
  publicKey = createPublicKey(readFileSync(pubPath, 'utf8'));
} catch (err) {
  fail(`can't read the public key ${pubPath}: ${err.message}`);
}
if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 3072) fail('the public key must be RSA, 3072 bits or more');

const datasets = {};
for (const pair of pairs) {
  const eq = pair.indexOf('=');
  if (eq < 1) fail(`expected name=file.json, got "${pair}"`);
  const name = pair.slice(0, eq);
  const path = pair.slice(eq + 1);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) fail(`dataset name "${name}" must be lowercase letters, digits and underscores`);
  let rows;
  try {
    rows = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${path}: ${err.message}`);
  }
  if (!Array.isArray(rows) || !rows.length) fail(`${path} must hold a non-empty JSON array of rows`);
  datasets[name] = rows;
}

const dataKey = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
const body = Buffer.concat([cipher.update(JSON.stringify({ sealed_at: new Date().toISOString(), datasets }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey);
writeFileSync(outPath, JSON.stringify({ v: 1, alg: 'RSA-OAEP-256+A256GCM', key: wrapped.toString('base64'), iv: iv.toString('base64'), data: body.toString('base64') }));
console.log(`Sealed ${Object.keys(datasets).join(', ')} into ${outPath}.`);
