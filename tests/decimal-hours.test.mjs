import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTotals, coverageGaps, excelCoverageGaps, DEFAULT_AIRCRAFT, fmt, getAircraft, hoursToTenths,
  isValidHourIncrement, paginate, prepareMigrationV2, sanitizeFlight,
  sanitizeOpening, setAircraft, sumFlights, validateAircraft, normalizeAircraft,
} from '../logic.js';

const flight = (id, hours, extra = {}) => sanitizeFlight({
  id, date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours, ...extra,
});

test('Decimal Hours use exact 0.1 increments with floating-point tolerance', () => {
  assert.equal(hoursToTenths(1.2), 12);
  assert.equal(hoursToTenths(0.3 + 0.6), 9);
  assert.equal(isValidHourIncrement(2.7), true);
  assert.equal(isValidHourIncrement(1.25), false);
  assert.equal(isValidHourIncrement(1.75), false);
  assert.equal(isValidHourIncrement(0), false);
  assert.equal(fmt(1.2 + 2.3), '3.5');
});

test('Valid flight hours sum directly by Aircraft × Duty', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const flights = [flight('a', 1.2), flight('b', 2.3), flight('c', 0.5, { duty: 'PC' })];
  const total = sumFlights(flights);
  assert.equal(total.hours, 4.0);
  assert.equal(total.byTypeDuty['AW139|CP/PI'], 3.5);
  assert.equal(total.byTypeDuty['AW139|PC'], 0.5);
});

test('Invalid precision is preserved and flagged, but excluded from totals', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const invalid = flight('bad', 1.25);
  assert.equal(invalid.hours, 1.25);
  assert.equal(invalid._dataIssues[0].code, 'INVALID_HOUR_PRECISION');
  assert.equal(sumFlights([invalid]).hours, 0);
  const mixed = sumFlights([flight('good', 1.2), invalid]);
  assert.equal(mixed.hours, 1.2);
});

test('Legacy Duty is preserved rather than rewritten to CP/PI', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const legacy = flight('legacy', 1.1, { duty: 'LEGACY-XYZ' });
  assert.equal(legacy.duty, 'LEGACY-XYZ');
  assert.ok(legacy._dataIssues.some((x) => x.code === 'LEGACY_DUTY'));
  assert.equal(sumFlights([legacy]).hours, 1.1);
});

test('Opening Balance accepts only 0.1 increments and reports original invalid values', () => {
  const opening = sanitizeOpening({
    hours: 12.3,
    byType: { AW139: 12.3 },
    byTypeDuty: { 'AW139|CP/PI': 12.25 },
  });
  assert.equal(opening.hours, 12.3);
  assert.equal(opening.byType.AW139, 12.3);
  assert.equal(opening.byTypeDuty['AW139|CP/PI'], undefined);
  assert.deepEqual(opening._dataIssues[0], {
    code: 'INVALID_HOUR_PRECISION', field: 'byTypeDuty.AW139|CP/PI', value: 12.25,
  });
});

test('Opening Balance and page cumulative totals use integer tenths', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const opening = sanitizeOpening({ hours: 0.3, byType: { AW139: 0.3 }, byTypeDuty: { 'AW139|CP/PI': 0.3 } });
  const pages = paginate([flight('a', 1.2), flight('b', 2.3)], opening);
  assert.equal(pages[0].forward.hours, 3.8);
  assert.equal(pages[0].forward.byTypeDuty['AW139|CP/PI'], 3.8);
});

test('Aircraft Configuration v2 supports more than eight aircraft and flexible duties', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: `aircraft_${i + 1}`, name: `AC${String(i + 1).padStart(2, '0')}`,
    kind: i === 11 ? 'sim' : 'multi', duties: i === 11 ? ['SIM'] : ['CP/PI', 'PC'],
    active: true, sortOrder: i + 1,
  }));
  // SIM is not a flight duty; invalid values are caught by validation.
  many[11].duties = ['CP/PI', 'PC'];
  assert.equal(validateAircraft(many), '');
  setAircraft(many);
  assert.equal(getAircraft().length, 12);
  assert.deepEqual(getAircraft()[0].duties, ['CP/PI', 'PC']);
  assert.deepEqual(getAircraft()[11].duties, ['CP/PI', 'PC']);
});

test('Stable Aircraft ID survives rename and reorder', () => {
  const original = normalizeAircraft([{ id: 'stable-1', name: 'OLDTYPE', kind: 'multi', duties: ['CP/PI', 'PC'] }]);
  const renamed = normalizeAircraft([{ ...original[0], name: 'NEWTYPE', sortOrder: 4 }]);
  assert.equal(renamed[0].id, 'stable-1');
  assert.deepEqual(renamed[0].duties, ['CP/PI', 'PC']);
});

test('Migration prepare phase assigns IDs, preserves Legacy Duty, and reports precision issues', () => {
  const preview = prepareMigrationV2({
    aircraft: DEFAULT_AIRCRAFT,
    flights: [
      { id: 'a', date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours: 1.2 },
      { id: 'b', date: '2026-01-02', type: 'AW139', duty: 'OLD-DUTY', hours: 1.25 },
    ],
    opening: { hours: 2.5, byTypeDuty: { 'AW139|CP/PI': 2.5, 'UNKNOWN|PC': 0.5 } },
  });
  assert.equal(preview.version, 2);
  assert.equal(preview.flights[0].migrated.aircraftId, 'ac_aw139');
  assert.equal(preview.flights[1].migrated.duty, 'OLD-DUTY');
  assert.equal(preview.dataQuality.invalidHourFlights, 1);
  assert.equal(preview.dataQuality.legacyDutyFlights, 1);
  assert.equal(preview.dataQuality.unresolvedOpeningEntries, 1);
  assert.ok(preview.opening._dataIssues.some((x) => x.code === 'UNKNOWN_AIRCRAFT_OPENING'));
  assert.equal(preview.opening.byAircraftDuty.ac_aw139['CP/PI'], 2.5);
  assert.equal(preview.requiresReview, true);
});

test('Coverage reports duties not configured for the Aircraft', () => {
  setAircraft([{ id: 'r44-id', name: 'R44X', kind: 'single', duties: ['CP/PI', 'PC'] }]);
  assert.equal(coverageGaps([{ type: 'R44X', aircraftId: 'r44-id', duty: 'SOLO' }], null), 1);
  assert.equal(coverageGaps([{ type: 'R44X', aircraftId: 'r44-id', duty: 'PC' }], null), 0);
  setAircraft(DEFAULT_AIRCRAFT);
});

test('Legacy Excel export coverage warns for Aircraft beyond 8 slots and custom Duty columns', () => {
  const aircraft = Array.from({ length: 9 }, (_, i) => ({ id: `id-${i}`, name: `AC${i + 1}`, kind: 'multi', duties: ['CP/PI', 'PC', 'CUSTOM'] }));
  assert.equal(excelCoverageGaps([{ type: 'AC1', duty: 'CUSTOM' }, { type: 'AC9', duty: 'PC' }], null, aircraft), 2);
  assert.equal(excelCoverageGaps([{ type: 'AC1', duty: 'CP/PI' }], null, aircraft), 0);
});

test('Excel Summary formulas are rebuilt from each Aircraft own configured Duties', async () => {
  const { rebuildSummary } = await import('../xlsxfill.js');
  const cols = 'BCDEFGHIJKLMNO'.split('');
  let xml = '';
  for (let r = 5; r <= 12; r++) xml += `<row r="${r}">${cols.map((c) => `<c r="${c}${r}"></c>`).join('')}</row>`;
  const out = rebuildSummary(xml, [{ id: 'a1', name: 'CUSTOM1', kind: 'multi', duties: ['CP/PI', 'PC'] }]);
  assert.match(out, /<c r="B5"[^>]*t="inlineStr"[^>]*>[\s\S]*CUSTOM1/);
  assert.match(out, /<c r="D5"[^>]*><f>'S50'!Z24<\/f><\/c>/);
  assert.match(out, /<c r="E5"[^>]*><f>'S50'!AH24<\/f><\/c>/);
  assert.match(out, /<c r="F5"[^>]*\/>/);
});

test('Unknown existing Aircraft ID is not rebound by matching display name', () => {
  setAircraft([{ id: 'current-id', name: 'SAME-NAME', kind: 'multi', duties: ['CP/PI'] }]);
  const f = sanitizeFlight({ id: 'legacy-v2', aircraftId: 'retired-id', type: 'SAME-NAME', date: '2026-01-01', duty: 'CP/PI', hours: 1.0 });
  assert.equal(f.aircraftId, 'retired-id');
  assert.ok(f._dataIssues.some((x) => x.code === 'UNKNOWN_AIRCRAFT'));
  setAircraft(DEFAULT_AIRCRAFT);
});
