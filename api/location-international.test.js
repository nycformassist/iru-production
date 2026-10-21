import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Directive §3.4 — international acceptance tests.
// No U.S.-only ZIP assumption may block a supported workflow; U.S.
// layered matching must remain functional.

const { resolveResources, resolveResourcesForLocation } = await import('../src/resources.ts');
const {
  isValidUsZip, isValidCanadianPostal, isValidPostalCode, isUsCountry,
} = await import('../src/location.ts');

describe('§3.4 international & location acceptance', () => {
  it('U.S. user with valid 5-digit ZIP gets local matches (Bronx 10451)', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '10451' });
    assert.equal(r.fallback, false);
    assert.equal(r.isInternational, false);
    assert.ok(r.local.length >= 1);
  });

  it('U.S. user with no local match gets honest fallback + national directories', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '99999' });
    assert.equal(r.fallback, true);
    assert.equal(r.local.length, 0);
    assert.ok(r.national.length >= 3);
  });

  it('Canadian user with alphanumeric postal code is international, never given a U.S. "local" org', () => {
    const r = resolveResourcesForLocation({ country: 'CA', postalCode: 'M5V 1J1', city: 'Toronto', region: 'ON' });
    assert.equal(r.isInternational, true);
    assert.equal(r.country, 'CA');
    assert.equal(r.local.length, 0);
    assert.equal(r.statewide.length, 0);
    assert.ok(r.national.length >= 1); // U.S. national directories, honestly labeled by UI
  });

  it('user in a country with a different postal format (UK) resolves without error', () => {
    const r = resolveResourcesForLocation({ country: 'GB', postalCode: 'SW1A 1AA', city: 'London' });
    assert.equal(r.isInternational, true);
    assert.equal(r.fallback, true);
  });

  it('user in a location with no postal code system can still resolve resources', () => {
    const r = resolveResourcesForLocation({ country: 'HT', city: 'Port-au-Prince' });
    assert.equal(r.isInternational, true);
    assert.ok(r.national.length >= 1);
  });

  it('international user seeking U.S. immigration information gets national directories', () => {
    const r = resolveResourcesForLocation({ country: 'MX', postalCode: '06000', city: 'Mexico City' });
    const names = r.national.map((d) => d.name);
    assert.ok(names.some((n) => n.includes('ImmigrationLawHelp')));
  });

  it('incomplete location (country only) never throws and never blocks', () => {
    const r = resolveResourcesForLocation({ country: 'FR' });
    assert.equal(r.isInternational, true);
    const r2 = resolveResourcesForLocation({});
    assert.equal(r2.country, 'US');
    assert.equal(r2.fallback, true);
    assert.ok(r2.national.length >= 1);
  });

  it('missing location entirely still yields national resources (federal readiness unaffected)', () => {
    const r = resolveResources('');
    assert.equal(r.fallback, true);
    assert.ok(r.national.length >= 3);
  });

  it('legacy resolveResources(zip) behavior is preserved (NYC regression)', () => {
    const r = resolveResources('10451');
    assert.equal(r.isNycCoverage, true);
    assert.equal(r.country, 'US');
    assert.equal(r.isInternational, false);
  });

  it('postal validators accept international formats and allow missing codes', () => {
    assert.equal(isValidUsZip('10451'), true);
    assert.equal(isValidUsZip('1045'), false);
    assert.equal(isValidUsZip('M5V 1J1'), false);
    assert.equal(isValidCanadianPostal('M5V 1J1'), true);
    assert.equal(isValidCanadianPostal('M5V1J1'), true);
    assert.equal(isValidPostalCode('CA', 'M5V 1J1'), true);
    assert.equal(isValidPostalCode('GB', 'SW1A 1AA'), true);
    assert.equal(isValidPostalCode('HT', ''), true); // no postal system — allowed
    assert.equal(isValidPostalCode('US', ''), true); // optional everywhere in IRU
    assert.equal(isValidPostalCode('US', 'ABCDE'), false);
    assert.equal(isUsCountry(undefined), true);
    assert.equal(isUsCountry('CA'), false);
  });
});
