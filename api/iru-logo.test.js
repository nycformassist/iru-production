/**
 * api/iru-logo.test.js — IRU app logo identity.
 *
 * Owner directive 2026-11-10 (second logo direction): the logo must look
 * MORE AMERICAN — red, white, and blue, with a shield and eagle (flag
 * motif). The app has its own identifying logo, "IRU — Immigration
 * Readiness Utility": a spread-wing eagle in Old Glory blue above a
 * stars-and-stripes shield, with "IRU" in blue and the full name in red.
 * No green, no teal, no black, no gold. This test pins that: the SMRG seal
 * asset is gone, the new logo exists and names the app, and no source file
 * references the old seal or the retired navy/gold mark.
 *
 * Run with: node --test api/iru-logo.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('SMRG seal asset is gone', () => {
  assert.equal(existsSync(join(ROOT, 'public/seal.png')), false, 'public/seal.png must not exist');
});

test('IRU logo asset exists and names the app', () => {
  const svg = read('public/iru-logo.svg');
  assert.match(svg, /IRU/, 'logo must say IRU');
  assert.match(svg, /IMMIGRATION READINESS UTILITY/, 'logo must say Immigration Readiness Utility');
  assert.match(svg, /#1e3a8a/, 'logo uses Old Glory blue');
  assert.match(svg, /#b22234/, 'logo uses Old Glory red');
  assert.match(svg, /#ffffff/, 'logo uses white');
  assert.match(svg, /shield/i, 'logo is a shield');
  assert.match(svg, /eagle/i, 'logo has an eagle');
  assert.match(svg, /star/i, 'logo has stars');
  assert.match(svg, /stripe/i, 'logo has stripes');
});

test('IRU logo has no green, teal, black, or gold', () => {
  const svg = read('public/iru-logo.svg').toLowerCase();
  for (const banned of ['#00ff00', '#008000', '#14b8a6', '#0d9488', '#2dd4bf', '#5eead4', '#000000', '#000', '#f59e0b', '#0a2a5e']) {
    assert.doesNotMatch(svg, new RegExp(banned, 'i'), `logo must not use ${banned}`);
  }
});

test('no source references the SMRG seal', () => {
  for (const file of ['src/App.tsx', 'src/paywall.tsx', 'src/constants.tsx', 'index.html']) {
    const src = read(file);
    assert.doesNotMatch(src, /seal\.png/, `${file} must not reference seal.png`);
    assert.doesNotMatch(src, /SMRG/, `${file} must not reference SMRG`);
  }
});

test('app renders the IRU logo', () => {
  const src = read('src/App.tsx');
  assert.match(src, /iru-logo\.svg/, 'App must render iru-logo.svg');
  assert.match(src, /IRU — Immigration Readiness Utility/, 'logo alt text names the app');
});

test('PWA icons exist at the manifest sizes', () => {
  for (const [file, size] of [['public/icons/icon-192.png', 192], ['public/icons/icon-512.png', 512]]) {
    const buf = readFileSync(join(ROOT, file));
    // PNG IHDR: width/height are big-endian uint32 at bytes 16/20.
    assert.equal(buf.readUInt32BE(16), size, `${file} width`);
    assert.equal(buf.readUInt32BE(20), size, `${file} height`);
  }
});
