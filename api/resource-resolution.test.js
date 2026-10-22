import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Tests for the layered resource model (src/resources.ts)
// Local → Statewide → National → Fallback
// These run against the TypeScript source via the project's test setup.

const { resolveResources, resolveResourcesForLocation, getAllOrgs } = await import('../src/resources.ts');

describe('Resource resolution — layered model', () => {
  it('Bronx ZIP (10451) returns Bronx Defenders + Bronx Legal Services as local', () => {
    const result = resolveResources('10451');
    assert.ok(!result.fallback, 'Should not be fallback for Bronx');
    assert.ok(result.isNycCoverage, 'Bronx is NYC coverage');
    assert.strictEqual(result.local.length, 2, 'Should have 2 Bronx orgs');
    const names = result.local.map(o => o.name);
    assert.ok(names.some(n => n.includes('Bronx Defenders')), 'Should include Bronx Defenders');
    assert.ok(names.some(n => n.includes('Bronx Legal Services')), 'Should include Bronx Legal Services');
  });

  it('Manhattan ZIP (10001) returns Legal Aid Society as local, NYC coverage', () => {
    const result = resolveResources('10001');
    assert.ok(!result.fallback);
    assert.ok(result.isNycCoverage);
    assert.strictEqual(result.local.length, 1);
    assert.ok(result.local[0].name.includes('Legal Aid Society'));
  });

  it('Los Angeles ZIP (90012) returns 2 verified LA orgs, not NYC orgs', () => {
    const result = resolveResources('90012');
    assert.ok(!result.fallback, 'LA should have local coverage');
    assert.ok(!result.isNycCoverage, 'LA is not NYC');
    assert.strictEqual(result.local.length, 2);
    const names = result.local.map(o => o.name);
    assert.ok(names.some(n => n.includes('Legal Aid Foundation')), 'Should include LAFLA');
    assert.ok(names.some(n => n.includes('Advancing Justice')), 'Should include Advancing Justice');
    // Must NOT include NYC orgs
    assert.ok(!names.some(n => n.includes('Bronx') || n.includes('Manhattan')),
      'Must not show NYC orgs for LA user');
  });

  it('Columbus ZIP (43215) returns 2 verified Ohio orgs', () => {
    const result = resolveResources('43215');
    assert.ok(!result.fallback);
    assert.strictEqual(result.local.length, 2);
    const names = result.local.map(o => o.name);
    assert.ok(names.some(n => n.includes('CRIS') || n.includes('Community Refugee')), 'Should include CRIS');
  });

  it('Houston ZIP (77002) returns 2 verified Houston orgs including Tahirih with eligibility note', () => {
    const result = resolveResources('77002');
    assert.ok(!result.fallback);
    assert.strictEqual(result.local.length, 2);
    const tahirih = result.local.find(o => o.name.includes('Tahirih'));
    assert.ok(tahirih, 'Should include Tahirih');
    assert.ok(tahirih.eligibility && tahirih.eligibility.includes('survivors'),
      'Tahirih must carry survivor-only eligibility restriction');
  });

  it('Miami ZIP (33130) returns 2 verified Miami orgs', () => {
    const result = resolveResources('33130');
    assert.ok(!result.fallback);
    assert.strictEqual(result.local.length, 2);
  });

  it('Chicago ZIP (60601) returns 2 verified Chicago orgs with NIJC address', () => {
    const result = resolveResources('60601');
    assert.ok(!result.fallback);
    assert.strictEqual(result.local.length, 2);
    const nijc = result.local.find(o => o.name.includes('National Immigrant Justice Center'));
    assert.ok(nijc, 'Should include NIJC');
    assert.ok(nijc.address.includes('Jackson Blvd'), 'NIJC should have verified street address');
  });

  it('Atlanta ZIP (30303) returns GAIN (statewide) + Latin American Association with eligibility notes', () => {
    const result = resolveResources('30303');
    assert.ok(!result.fallback);
    // GAIN is statewide, LAA is local
    assert.strictEqual(result.local.length, 1, 'Should have 1 local (LAA)');
    assert.strictEqual(result.statewide.length, 1, 'Should have 1 statewide (GAIN)');
    const gain = result.statewide[0];
    assert.ok(gain.name.includes('GAIN') || gain.name.includes('Georgia Asylum'));
    assert.ok(gain.eligibility && gain.eligibility.includes('survivors'),
      'GAIN must carry survivor-only eligibility restriction');
    assert.ok(gain.phone === '(678) 335-6040', 'GAIN phone should be verified');
    const laa = result.local[0];
    assert.ok(laa.eligibility && laa.eligibility.includes('detained'),
      'LAA must note detained-case exclusion');
  });

  it('Uncovered ZIP (e.g., 99999 Alaska) triggers fallback with national directories', () => {
    const result = resolveResources('99999');
    assert.ok(result.fallback, 'Unknown area should trigger fallback');
    assert.ok(!result.isNycCoverage);
    assert.strictEqual(result.local.length, 0, 'No local orgs for uncovered ZIP');
    assert.ok(result.national.length >= 3, 'Should provide national directory links');
    const dirNames = result.national.map(d => d.name);
    assert.ok(dirNames.some(n => n.includes('ImmigrationLawHelp')), 'Should link ImmigrationLawHelp.org');
    // ImmigrationLawHelp URL should include the user's ZIP
    const ilh = result.national.find(d => d.name.includes('ImmigrationLawHelp'));
    assert.ok(ilh.url.includes('99999'), 'Directory URL should embed user ZIP');
  });

  it('Invalid/empty ZIP handled gracefully (fallback, no crash)', () => {
    const empty = resolveResources('');
    assert.ok(empty.fallback);
    assert.strictEqual(empty.prefix, '');
    const short = resolveResources('12');
    assert.ok(short.fallback);
  });

  it('National directories always provided (all 7 validation ZIPs)', () => {
    for (const zip of ['10451', '90012', '43215', '77002', '33130', '60601', '30303']) {
      const result = resolveResources(zip);
      assert.ok(result.national.length >= 3, `ZIP ${zip} should have national directories`);
    }
  });

  it('No org is presented as local outside its verified service area', () => {
    // Spot check: LA orgs must not appear for Chicago ZIP and vice versa
    const la = resolveResources('90012');
    const chi = resolveResources('60601');
    const laIds = new Set(la.local.map(o => o.id));
    const chiIds = new Set(chi.local.map(o => o.id));
    for (const id of laIds) {
      assert.ok(!chiIds.has(id), `Org ${id} should not appear in both LA and Chicago`);
    }
  });

  it('All orgs have required verification fields (no invented data)', () => {
    for (const org of getAllOrgs()) {
      assert.ok(org.name, `${org.id}: name required`);
      assert.ok(org.website, `${org.id}: website required`);
      assert.ok(org.phone, `${org.id}: phone required`);
      assert.ok(org.address, `${org.id}: address required`);
      assert.ok(org.serviceArea, `${org.id}: serviceArea required`);
      assert.ok(org.servicesOffered, `${org.id}: servicesOffered required`);
      assert.ok(org.sourceOfVerification, `${org.id}: sourceOfVerification required`);
      assert.ok(org.lastVerified, `${org.id}: lastVerified required`);
      assert.ok(typeof org.legalRepresentation === 'boolean',
        `${org.id}: legalRepresentation must be explicit boolean`);
    }
  });

  it('NYC regression: original 5 boroughs still resolve correctly', () => {
    const tests = [
      ['10001', 'Legal Aid Society'],
      ['10451', 'Bronx Defenders'],
      ['11101', 'MinKwon'],
      ['11201', 'Brooklyn Legal Services'],
      ['10301', 'Project Hospitality'],
    ];
    for (const [zip, expected] of tests) {
      const result = resolveResources(zip);
      assert.ok(result.isNycCoverage, `${zip} should be NYC coverage`);
      assert.ok(result.local.some(o => o.name.includes(expected)),
        `${zip} should include ${expected}`);
    }
  });

  it('NYC orgs preserve transit/exit details', () => {
    const result = resolveResources('10451');
    const bd = result.local.find(o => o.id === 'nyc-bronx-defenders');
    assert.ok(bd.transit && bd.exit, 'Bronx Defenders must preserve transit/exit');
  });
});

describe('D7: city/state fallback when no ZIP is given', () => {
  // Browser E2E (2026-10-22): a Brooklyn persona who gave city + state but
  // no ZIP (ZIP is optional by design) got "No verified local organization
  // was matched" — resolution consulted ONLY the ZIP prefix and ignored
  // the city/state the interview collected.
  it('Brooklyn + New York, no ZIP → the verified Brooklyn org is local', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Brooklyn', region: 'New York' });
    assert.equal(r.fallback, false);
    assert.ok(r.local.some((o) => o.id === 'nyc-brooklyn-legal'), 'Brooklyn Legal Services must match by city');
    assert.equal(r.matchedBy, 'city');
    assert.equal(r.isNycCoverage, true);
  });

  it('region as a state code ("NY") resolves the same', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Brooklyn', region: 'NY' });
    assert.ok(r.local.some((o) => o.id === 'nyc-brooklyn-legal'));
    assert.equal(r.fallback, false);
  });

  it('Atlanta + Georgia, no ZIP → Atlanta local org + GAIN statewide', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Atlanta', region: 'Georgia' });
    assert.ok(r.local.some((o) => o.id === 'ga-laa'), 'Latin American Association (Atlanta area) is local');
    assert.ok(r.statewide.some((o) => o.id === 'ga-gain'), 'GAIN serves Georgia statewide');
    assert.equal(r.fallback, false);
  });

  it('state-only match: Georgia city with no listed local org still surfaces the statewide org', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Savannah', region: 'Georgia' });
    assert.equal(r.local.length, 0, 'no Savannah org exists — none may be invented');
    assert.ok(r.statewide.some((o) => o.id === 'ga-gain'));
    assert.equal(r.matchedBy, 'state');
    assert.equal(r.fallback, false);
  });

  it('no verified coverage → honest fallback, never an invented org', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Albany', region: 'New York' });
    assert.equal(r.local.length, 0);
    assert.equal(r.statewide.length, 0);
    assert.equal(r.fallback, true);
    assert.equal(r.matchedBy, 'none');
  });

  it('state guard: a Brooklyn city name does not match when the state disagrees', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '', city: 'Brooklyn', region: 'California' });
    assert.ok(!r.local.some((o) => o.id === 'nyc-brooklyn-legal'),
      'the Brooklyn (NY) org must not be presented as local to a California resident');
    assert.equal(r.fallback, true);
  });

  it('ZIP behavior is unchanged when a ZIP is given', () => {
    const r = resolveResourcesForLocation({ country: 'US', postalCode: '11201', city: '', region: '' });
    assert.equal(r.matchedBy, 'zip');
    assert.ok(r.local.some((o) => o.id === 'nyc-brooklyn-legal'));
  });
});
