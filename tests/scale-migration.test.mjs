import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAircraft, setAircraft, prepareMigrationV2, sumFlights } from '../logic.js';

test('12 Aircraft and 900 flight records migrate without precision loss or record loss', () => {
  const aircraft = normalizeAircraft(Array.from({ length: 12 }, (_, i) => ({
    id: `aircraft-${i + 1}`, name: `AC${String(i + 1).padStart(2, '0')}`,
    kind: i === 11 ? 'sim' : (i % 2 ? 'single' : 'multi'),
    duties: i % 3 === 0 ? ['CP/PI', 'PC', 'SOLO'] : ['CP/PI', 'PC', 'MP', 'IP', 'SP'],
    active: true, sortOrder: i + 1,
  })));
  setAircraft(aircraft);
  const flights = Array.from({ length: 900 }, (_, i) => ({
    id: `flight-${i + 1}`, date: `2026-${String(Math.floor(i / 28) % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`,
    aircraftId: aircraft[i % 12].id, type: aircraft[i % 12].name,
    duty: i % 17 === 0 ? 'LEGACY-DUTY' : aircraft[i % 12].duties[i % aircraft[i % 12].duties.length],
    hours: ((i % 27) + 1) / 10,
  }));
  const before = sumFlights(flights).hours;
  const preview = prepareMigrationV2({ aircraft, flights, opening: null });
  const migrated = preview.flights.map((x) => x.migrated).filter(Boolean);
  assert.equal(migrated.length, 900);
  assert.equal(preview.dataQuality.invalidHourFlights, 0);
  assert.equal(preview.dataQuality.invalidFlights, 0);
  assert.equal(sumFlights(migrated).hours, before);
  assert.ok(preview.dataQuality.legacyDutyFlights > 0);
});

import { addHiddenExportColumns, buildDynamicAircraftSummary, buildDynamicDataQuality, pageValues } from '../xlsxfill.js';

test('Dynamic Excel summary includes all Aircraft/Duties beyond eight slots and references S1-S50', () => {
  const aircraft = Array.from({ length: 12 }, (_, i) => ({
    id: `ac-${i + 1}`, name: `TYPE-${i + 1}`, kind: i === 11 ? 'sim' : 'multi',
    duties: i === 11 ? ['SIM-DUTY', 'SOLO'] : ['CP/PI', 'PC'],
  }));
  const xml = buildDynamicAircraftSummary(aircraft, { byAircraftDuty: { 'ac-12': { 'SIM-DUTY': 2.3 } } }, [{ aircraftId: 'ac-12', type: 'TYPE-12', duty: 'LEGACY-ROLE', hours: 0.6 }]);
  assert.match(xml, /TYPE-12/);
  assert.match(xml, /SIM-DUTY/);
  assert.match(xml, /LEGACY-ROLE/);
  assert.match(xml, /<c r="D\d+"><v>2\.3<\/v><\/c>/);
  assert.match(xml, /SUMIFS\('S1'!\$I\$4:\$I\$21,'S1'!\$DE\$4:\$DE\$21,\$G\d+,'S1'!\$H\$4:\$H\$21,\$C\d+,'S1'!\$DF\$4:\$DF\$21,1\)/);
  assert.match(xml, /SUMIFS\('S50'!/);
  assert.match(xml, /Aircraft ID/);
  assert.match(xml, /Aircraft Type List/);
});

test('Dynamic Excel Data Quality sheet preserves issue codes and original values', () => {
  const xml = buildDynamicDataQuality([{ id: 'f1', type: 'AW139', date: '2026-01-01', _dataIssues: [{ code: 'LEGACY_DUTY', field: 'duty', value: 'PIC-OLD' }] }], null);
  assert.match(xml, /LEGACY_DUTY/);
  assert.match(xml, /PIC-OLD/);
});


test('Excel page export writes Stable Aircraft ID and a valid 0.1-hour marker', () => {
  const aircraft = [{ id: 'stable-aircraft-7', name: 'RENAMED7', kind: 'multi', duties: ['CP/PI'] }];
  const values = pageValues({ n: 1, rows: [
    { id: 'f1', date: '2026-01-01', type: 'RENAMED7', aircraftId: 'stable-aircraft-7', duty: 'CP/PI', hours: 1.2 },
    { id: 'f2', date: '2026-01-02', type: 'RENAMED7', aircraftId: 'stable-aircraft-7', duty: 'CP/PI', hours: 1.25 },
    { id: 'f3', date: '2026-01-03', type: 'RENAMED7', duty: 'CP/PI', hours: 0.5 },
  ] }, aircraft);
  assert.equal(values.DE4, 'stable-aircraft-7');
  assert.equal(values.DF4, 1);
  assert.equal(values.DE5, 'stable-aircraft-7');
  assert.equal(values.DF5, 0);
  assert.equal(values.DE6, 'stable-aircraft-7');
  assert.equal(values.DF6, 1);
});

test('Hidden helper columns extend sheet dimensions without changing visible columns', () => {
  const source = '<worksheet><dimension ref="A1:DD34"/><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="68" width="10"/></cols><sheetData/></worksheet>';
  const out = addHiddenExportColumns(source);
  const twice = addHiddenExportColumns(out);
  assert.match(out, /dimension ref="A1:DF34"/);
  assert.match(out, /<col min="109" max="110" width="0" hidden="1"/);
  assert.equal((twice.match(/<col min="109" max="110"/g) || []).length, 1);
});


test('Stable Aircraft ID prevents same-name records with another ID from entering the Duty set', () => {
  const aircraft = [{ id: 'id-current', name: 'SAME-NAME', kind: 'multi', duties: ['CP/PI'] }];
  const xml = buildDynamicAircraftSummary(aircraft, null, [
    { id: 'f-old', aircraftId: 'id-retired', type: 'SAME-NAME', duty: 'OLD-DUTY', hours: 1.2 },
    { id: 'f-current', aircraftId: 'id-current', type: 'SAME-NAME', duty: 'CP/PI', hours: 0.5 },
  ]);
  assert.match(xml, /<t xml:space="preserve">CP\/PI<\/t>/);
  assert.doesNotMatch(xml, /OLD-DUTY/);
  assert.match(xml, /<t xml:space="preserve">id-current<\/t>/);
});
