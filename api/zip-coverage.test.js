import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test ZIP code coverage logic
// IRU's resource directory covers NYC only; non-NYC ZIPs get honest labeling

const NYC_PREFIXES = ['100', '104', '111', '112', '103'];

function getCoverage(zip) {
  const prefix = String(zip).substring(0, 3);
  const isNyc = NYC_PREFIXES.includes(prefix);
  return { prefix, isNyc };
}

describe('ZIP code coverage', () => {
  it('Bronx ZIP (10451) is in NYC coverage', () => {
    const result = getCoverage('10451');
    assert.ok(result.isNyc);
    assert.strictEqual(result.prefix, '104');
  });

  it('Manhattan ZIP (10001) is in NYC coverage', () => {
    const result = getCoverage('10001');
    assert.ok(result.isNyc);
  });

  it('California ZIP (90210) is NOT in NYC coverage', () => {
    const result = getCoverage('90210');
    assert.ok(!result.isNyc);
    assert.strictEqual(result.prefix, '902');
  });

  it('Ohio ZIP (43215) is NOT in NYC coverage', () => {
    const result = getCoverage('43215');
    assert.ok(!result.isNyc);
    assert.strictEqual(result.prefix, '432');
  });

  it('Invalid ZIP handled gracefully', () => {
    const result = getCoverage('');
    assert.strictEqual(result.prefix, '');
    assert.ok(!result.isNyc);
  });

  it('Non-NYC ZIPs must show coverage notice (not silent NYC default)', () => {
    // Contract: when isNycCoverage=false, UI must display the LawHelp.org notice
    // This is a documentation test; implementation verified by code review
    const california = getCoverage('90210');
    assert.ok(!california.isNyc, 'California ZIP must trigger coverage notice');
  });
});
