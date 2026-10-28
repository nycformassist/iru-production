// Recreation notice wording (2026-10-28 supplement, item 3): when the page
// is recreated during the picker, say plainly that this is a phone/browser
// lifecycle limit and not the user's mistake. This is the only user-facing
// change in the picker-routes work, so it has its own test and commit.
// Self-verified (back-translated) in ES/ZH/HT/AR; not native-reviewed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const constants = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

test('the recreation notice carries a reassurance line, shown inside the notice only', () => {
  const i = app.indexOf('{pickerRecreatedNotice && !photoFile && (');
  assert.ok(i > 0);
  const notice = app.slice(i, i + 900);
  assert.match(notice, /<p className="m-0">\{pickerRecreatedNotice\}<\/p>/);
  assert.match(notice, /t\('pickerRecreatedWhy', 'This is a limit of how some phones return from the photo picker\. It is not something you did wrong\.'\)/);
  assert.match(notice, /<label htmlFor="iru-photo-input"/, 'the one-tap retry control is still there');
  assert.equal((app.match(/pickerRecreatedWhy/g) || []).length, 1, 'used in exactly one place');
});

test('the reassurance exists in all five languages and blames no one', () => {
  assert.equal((constants.match(/pickerRecreatedWhy:/g) || []).length, 5);
  const en = /pickerRecreatedWhy: "([^"]+)"/.exec(constants)[1];
  assert.match(en, /not something you did wrong/);
  // It must not invent an unproven cause or a remedy.
  assert.ok(!/memory|close other apps|restart|update/i.test(en));
});
