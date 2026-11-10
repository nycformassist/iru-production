/**
 * src/EntryScreen.rtl.test.tsx — Entry-screen language selector.
 *
 * Owner finding 2026-11-10: the entry ("Choose Your pathway") page had NO
 * foreign-language selection, so a non-English speaker was stuck on English
 * pathway questions. The language selector must be FIRST on the entry screen
 * — above the title and pathway options — and choosing a language must
 * switch the entry screen into that language.
 *
 * Run with: npx tsx --test src/EntryScreen.rtl.test.tsx
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// --- jsdom setup (same as Phase3Integration.rtl.test.tsx) ---
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
const g = global as any;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.window.confirm = () => true;

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { EntryScreen, pt } from './paywall';

test('entry screen shows the language selector FIRST, above the title and pathway options', () => {
  const { container } = render(
    <EntryScreen lang="EN" onNavigate={() => {}} onLanguageChange={() => {}} />,
  );
  const selector = container.querySelector('[data-testid="entry-language-selector"]');
  assert.ok(selector, 'language selector block must exist');
  const title = container.querySelector('h1');
  assert.ok(title, 'entry title must exist');
  // Selector must precede the title in document order.
  assert.ok(
    (selector!.compareDocumentPosition(title!) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    'language selector must come before the entry title',
  );
  // All five languages, named in their own script.
  for (const [code, name] of [['EN', 'English'], ['ES', 'Español'], ['ZH', '简体中文'], ['HT', 'Kreyòl Ayisyen'], ['AR', 'العربية']] as const) {
    const btn = container.querySelector(`[data-testid="entry-language-${code}"]`);
    assert.ok(btn, `language button ${code} must exist`);
    assert.equal(btn!.textContent, name);
  }
  // The four pathway options still render below.
  assert.match(container.textContent || '', /Find which forms fit me/);
  assert.match(container.textContent || '', /I know what I need/);
  assert.match(container.textContent || '', /I already purchased — recover access/);
  assert.match(container.textContent || '', /Browse forms/);
});

test('choosing Español calls onLanguageChange with ES and re-renders the entry screen in Spanish', () => {
  let chosen: string | null = null;
  const { container, rerender } = render(
    <EntryScreen lang="EN" onNavigate={() => {}} onLanguageChange={(code) => { chosen = code; }} />,
  );
  const esBtn = container.querySelector('[data-testid="entry-language-ES"]');
  assert.ok(esBtn, 'Español button must exist');
  fireEvent.click(esBtn!);
  assert.equal(chosen, 'ES');
  // Parent applies the new lang: entry title + options render in Spanish.
  rerender(<EntryScreen lang="ES" onNavigate={() => {}} onLanguageChange={() => {}} />);
  assert.match(container.textContent || '', /Prepare sus formularios de inmigración/);
  assert.match(container.textContent || '', /Descubrir qué formularios me corresponden/);
  assert.match(container.textContent || '', /Sé lo que necesito/);
  // Selector heading itself is in Spanish, and Español is the pressed button.
  assert.match(container.textContent || '', /Elija su idioma/);
  assert.equal(container.querySelector('[data-testid="entry-language-ES"]')?.getAttribute('aria-pressed'), 'true');
  assert.equal(container.querySelector('[data-testid="entry-language-EN"]')?.getAttribute('aria-pressed'), 'false');
});

test('Continue my case card translates in all five languages (owner finding 2026-11-10)', () => {
  // The card is rendered by App.tsx after <EntryScreen/>, not inside it,
  // and it reads pt('entryContinue' / 'entryContinueDesc', lang) — the
  // same function the four pathway cards use. Before this fix those keys
  // were undefined and the card fell back to English in every language.
  const expected: Record<string, [string, string]> = {
    EN: ['Continue my case', 'You already bought IRU on this device. We will verify your purchase and take you back to your case.'],
    ES: ['Continuar con mi caso', 'Ya compró IRU en este dispositivo. Verificaremos su compra y lo llevaremos de vuelta a su caso.'],
    ZH: ['继续我的案件', '您已在此设备上购买了 IRU。我们将验证您的购买，并将您带回您的案件。'],
    HT: ['Kontinye ak ka mwen', 'Ou te deja achte IRU sou aparèy sa a. N ap verifye acha ou epi mennen ou tounen nan ka ou.'],
    AR: ['متابعة قضيتي', 'لقد اشتريت IRU بالفعل على هذا الجهاز. سنقوم بالتحقق من عملية الشراء وإعادتك إلى قضيتك.'],
  };
  for (const [code, [title, desc]] of Object.entries(expected)) {
    assert.equal(pt('entryContinue', code as 'EN' | 'ES' | 'ZH' | 'HT' | 'AR'), title, `entryContinue in ${code}`);
    assert.equal(pt('entryContinueDesc', code as 'EN' | 'ES' | 'ZH' | 'HT' | 'AR'), desc, `entryContinueDesc in ${code}`);
  }
  // In Spanish the text must differ from English — the exact failure the
  // owner saw (card stayed in English in the Spanish view).
  assert.notEqual(pt('entryContinue', 'ES'), pt('entryContinue', 'EN'));
  assert.notEqual(pt('entryContinueDesc', 'ES'), pt('entryContinueDesc', 'EN'));
});
