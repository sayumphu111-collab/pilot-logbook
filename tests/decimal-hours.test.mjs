import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTotals, coverageGaps, emptyTotals, fmt, paginate, rowToFlight,
  sanitizeFlight, sanitizeOpening, setAircraft, sumFlights, DEFAULT_AIRCRAFT,
} from '../logic.js';

test('Decimal Hours are summed directly for Aircraft Type × Duty', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const flights = [
    { id: 'a', date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours: 1.25 },
    { id: 'b', date: '2026-01-02', type: 'AW139', duty: 'CP/PI', hours: 2.375 },
    { id: 'c', date: '2026-01-03', type: 'AW139', duty: 'PC', hours: 0.625 },
  ].map(sanitizeFlight);
  const total = sumFlights(flights);
  assert.equal(total.hours, 4.25);
  assert.equal(total.byTypeDuty['AW139|CP/PI'], 3.625);
  assert.equal(total.byTypeDuty['AW139|PC'], 0.625);
});

test('Import and sanitization retain decimal precision', () => {
  const row = [];
  row[1] = new Date('2026-01-01T00:00:00Z');
  row[2] = 'AW139';
  row[7] = 'CP/PI';
  row[8] = 1.234567;
  const imported = rowToFlight(row);
  assert.equal(imported.hours, 1.234567);
  const clean = sanitizeFlight({ id: 'x', date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours: 1.234567 });
  assert.equal(clean.hours, 1.234567);
  assert.equal(fmt(1.234567), '1.234567');
  assert.equal(fmt(1.2345678912345), '1.2345678912345');
});

test('Opening balance and page cumulative totals add decimal values directly', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const opening = sanitizeOpening({
    hours: 0.375,
    byType: { AW139: 0.375 },
    byTypeDuty: { 'AW139|CP/PI': 0.375 },
  });
  const flight = sanitizeFlight({ id: 'a', date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours: 1.125 });
  const pages = paginate([flight], opening);
  assert.equal(pages[0].forward.hours, 1.5);
  assert.equal(pages[0].forward.byTypeDuty['AW139|CP/PI'], 1.5);
});

test('Opening totals with unsupported type-duty slots are detected for Excel export', () => {
  setAircraft([
    { name: 'R44X', kind: 'single' },
    { name: 'H145X', kind: 'multi' },
    { name: 'SIMX', kind: 'sim' },
  ]);
  const opening = { byTypeDuty: { 'R44X|SOLO': 1.25 } };
  assert.equal(coverageGaps([], opening), 1);
  assert.equal(coverageGaps([{ type: 'R44X', duty: 'CP/PI' }], null), 0);
  setAircraft(DEFAULT_AIRCRAFT);
});
