import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AIRCRAFT, paginate, prepareMigrationV2, sanitizeFlight,
  sanitizeOpening, setAircraft, sortFlights, sumFlights,
} from '../logic.js';
import {
  buildDynamicAircraftSummary, openingValues, pageValues, retargetSimHoursColumn,
} from '../xlsxfill.js';

const config = [
  { id: 'ac_aw139', name: 'AW139', kind: 'multi', duties: ['CP/PI', 'SP'] },
  { id: 'sim_1', name: 'SIM', kind: 'sim', duties: ['CP/PI', 'IP', 'SP'] },
];
const flights = () => [
  sanitizeFlight({ id: 'sim-other', date: '2026-01-01', type: 'SIM', aircraftId: 'sim_1', duty: 'CP/PI', hours: 1.2 }),
  sanitizeFlight({ id: 'sim-sp', date: '2026-01-02', type: 'SIM', aircraftId: 'sim_1', duty: 'SP', hours: 0.5 }),
  sanitizeFlight({ id: 'real', date: '2026-01-03', type: 'AW139', aircraftId: 'ac_aw139', duty: 'CP/PI', hours: 2.0 }),
];

test('P1-SIM: SIM นอก SP ไม่นับชั่วโมงบินจริง แต่ยังอยู่ในยอด Simulator', () => {
  setAircraft(config);
  const list = flights();
  const t = sumFlights(list);
  assert.equal(t.hours, 2.5);
  assert.equal(t.loggedHours, 3.7);
  assert.equal(t.sim, 1.7);
  assert.equal(t.byType.sim_1, 1.7);
  assert.equal(t.byTypeDuty['sim_1|CP/PI'], 1.2);
  assert.equal(t.byTypeDuty['sim_1|SP'], 0.5);
  const page = paginate(list, null)[0];
  assert.equal(page.thisPage.hours, 2.5);
  assert.equal(page.forward.hours, 2.5);
  setAircraft(DEFAULT_AIRCRAFT);
});

test('Excel I ไม่รวม SIM นอก SP แต่ DG ยังเก็บชั่วโมงที่กรอกทั้งหมด', () => {
  setAircraft(config);
  const values = pageValues(paginate(flights(), null)[0], config);
  assert.equal(values.I4, 0);
  assert.equal(values.I5, 0.5);
  assert.equal(values.I6, 2);
  assert.equal(values.DG4, 1.2);
  assert.equal(values.DG5, 0.5);
  assert.equal(values.DG6, 2);
  assert.equal(values.DE4, 'sim_1');
  assert.equal(values.DF4, 1);
  const xml = retargetSimHoursColumn('<row r="4"><c r="S4"><f>IF($C4="FLIGHT-SIM", $I4,"-")</f></c></row>');
  assert.match(xml, /\$DG4/);
  assert.match(xml, /FLIGHT-SIM/); // ไม่เขียนทับชื่อที่ customizeTemplate เปลี่ยนไว้
  setAircraft(DEFAULT_AIRCRAFT);
});

test('ยอดยกมาใช้ aircraftId เป็นแกนและแจ้งความขัดแย้งแทนการเลือกข้างเงียบ ๆ', () => {
  setAircraft(config);
  const o = sanitizeOpening({
    hours: 2.5,
    byAircraftDuty: { sim_1: { SP: 0.5 } },
    byTypeDuty: { 'sim_1|SP': 0.7, 'SIM|CP/PI': 1.2 },
  }, config);
  assert.ok(o._dataIssues.some((x) => x.code === 'OPENING_CONFLICT' && x.field === 'sim_1|SP'));
  assert.equal(o.byAircraftDuty.sim_1.SP, 0.5);
  assert.equal(o.byTypeDuty['sim_1|CP/PI'], 1.2);
  // SIM อยู่ช่อง index 1 ของ config → SP ถูกเขียนที่ BF+1 = BG23
  assert.equal(openingValues(o, config).BG23, 0.5);
  assert.equal(openingValues(o, config).M23, 1.7); // รวมทุก duty ของ SIM (ไม่ใช่เฉพาะ SP)
  setAircraft(DEFAULT_AIRCRAFT);
});

test('Migration เติม ord ที่หายตามวันที่โดยไม่ขยับลำดับเดิม', () => {
  const source = [
    { id: 'late', date: '2026-02-02', type: 'AW139', duty: 'CP/PI', hours: 1.0 },
    { id: 'early', date: '2026-01-01', type: 'AW139', duty: 'CP/PI', hours: 1.0 },
    { id: 'anchored', date: '2026-03-03', type: 'SIM', duty: 'SP', hours: 1.0, ord: 5 },
  ];
  const preview = prepareMigrationV2({ aircraft: config, flights: source });
  assert.equal(preview.dataQuality.ordBackfilled, 2);
  const byId = Object.fromEntries(preview.flights.map((x) => [x.source.id, x.migrated]));
  assert.equal(byId.anchored.ord, 5);
  assert.ok(byId.early.ord > byId.anchored.ord);
  assert.ok(byId.late.ord > byId.early.ord);

  const allMissing = prepareMigrationV2({ aircraft: config, flights: source.slice(0, 2) });
  const clean = Object.fromEntries(allMissing.flights.map((x) => [x.source.id, x.migrated]));
  assert.equal(clean.early.ord, 0);
  assert.equal(clean.late.ord, 1048576);
  assert.deepEqual(sortFlights([{ id: 'z', date: '2026-01-02' }, { id: 'a', date: '2026-01-01' }]).map((f) => f.id), ['a', 'z']);
});

test('Aircraft Summary ของ SIM หรือ DG เพื่อยังแสดงยอดจำลองแยกต่างหาก', () => {
  setAircraft(config);
  const xml = buildDynamicAircraftSummary(config, { byAircraftDuty: { sim_1: { SP: 0.5 } } }, flights());
  const hoursCols = [...xml.matchAll(/SUMIFS\('S1'!\$([A-Z]+)\$4/g)].map((m) => m[1]);
  assert.ok(hoursCols.includes('DG'));
  assert.ok(hoursCols.includes('I'));
  setAircraft(DEFAULT_AIRCRAFT);
});
