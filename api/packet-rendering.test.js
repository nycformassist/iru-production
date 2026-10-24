import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source guards for the 2026-10-24 on-screen packet fix: the Readiness
// Score, Priority Action Table, and Safe-Landing Hub sections must
// render in the on-screen PACKET JSX — not only in the printable packet
// document template (generateHtml), where they previously lived alone
// while the on-screen header promised them and the Next Steps text
// referenced a "Safe-Landing Hub above" that did not exist on screen.
// JSX usages ({ui.…}) are distinguished from template usages
// (${ui.…}) so these guards fail if the sections retreat to the
// printable document only.

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('on-screen packet sections (2026-10-24 fix)', () => {
  it('renders the Readiness Score and Readiness Review on screen', () => {
    assert.ok(app.includes('{ui.readinessScore}'), 'on-screen packet must render the readiness score');
    assert.ok(app.includes('{renderAssessmentText(assessment)}'), 'on-screen packet must render the assessment text');
    assert.ok(app.includes('calculateReadinessScore()'), 'score must come from the shared heuristic');
  });

  it('renders the Priority Action Table on screen from the shared triage builder', () => {
    assert.ok(app.includes('const buildTriageRows'), 'shared triage builder must exist at component scope');
    assert.ok(app.includes('const { rows: triageRowData, hasAlternatives } = buildTriageRows();'),
      'generateHtml must consume the shared builder (printable output unchanged)');
    assert.ok(app.includes('{ui.triageTable}'), 'on-screen packet must render the triage table heading');
    assert.ok(app.includes('buildTriageRows()'), 'on-screen packet must render rows from the shared builder');
  });

  it('renders the Safe-Landing Hub section on screen above Next Steps', () => {
    assert.ok(app.includes('{ui.localResources}'), 'on-screen packet must render the Safe-Landing Hub heading');
    const hubAt = app.indexOf('{ui.localResources}');
    const packageAt = app.indexOf('Your preparation package (defect-closure P3B)');
    assert.ok(hubAt > 0 && hubAt < packageAt, 'Safe-Landing Hub must render above the package/Next Steps sections');
    assert.ok(app.includes('resources.map((res: any)'), 'Hub cards must render from the location-matched resources state');
  });
});
