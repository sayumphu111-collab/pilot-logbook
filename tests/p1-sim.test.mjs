import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AIRCRAFT, paginate, prepareMigrationV2, sanitizeFlight,
  sanitizeOpening, setAircraft, simDutyBreakdown, sortFlights, sumFlights,
} from '../logic.js';
import {
  buildDynamicAircraftSummary, openingValues, pageValues, rebuildSummary, retargetSimHoursColumn,
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

const summaryXml = () => {
  const cols = 'BCDEFGHNOPQ'.split('');
  let xml = '';
  for (let r = 5; r <= 12; r++) xml += `<row r="${r}">${cols.map((c) => `<c r="${c}${r}"><v>0</v></c>`).join('')}</row>`;
  xml += `<row r="20">${cols.map((c) => `<c r="${c}20"><f>SUM(C20:H20,N20)</f><v>0</v></c>`).join('')}</row>`;
  return xml;
};
const summaryCell = (xml, ref) => new RegExp(`<c r="${ref}"(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</c>)`).exec(xml)?.[0] || '';

test('Summary: ชั่วโมงบินรวม (Q20) ไม่รวม SIM นอก SP แต่คอลัมน์ N ยังเป็นยอดจำลองเต็ม', () => {
  const out = rebuildSummary(summaryXml(), DEFAULT_AIRCRAFT); // SIM อยู่แถว 12 (index 7)
  assert.match(summaryCell(out, 'Q20'), /SUM\(O20:P20,H12\)/);
  assert.doesNotMatch(summaryCell(out, 'Q20'), /N12|N20/);
  assert.match(summaryCell(out, 'N12'), /'S50'!S24/); // ยอด SIM เต็มยังอยู่ใน N ตามเงื่อนไขเดิม
  assert.match(summaryCell(out, 'H12'), /'S50'!BM24/); // SP ของ SIM (BF+7)
  assert.match(summaryCell(out, 'D12'), /'S50'!AG24/); // CP/PI ของ SIM แสดงแยก (Z+7)
  assert.match(summaryCell(out, 'P5'), /SUM\(C5:H5\)/); // AW139 = multi → P
  assert.match(summaryCell(out, 'P6'), /SUM\(C6:H6\)/); // AW149 = multi → P
});

test('Summary: SIM ไม่ได้อยู่แถว 12 ก็ยังตัด SIM นอก SP ออกจาก Q20', () => {
  const cfg = [
    { id: 'a', name: 'AW139', kind: 'multi', duties: ['CP/PI', 'SP'] },
    { id: 's', name: 'SIM', kind: 'sim', duties: ['CP/PI', 'IP', 'SP'] },
  ];
  const out = rebuildSummary(summaryXml(), cfg); // SIM อยู่แถว 6 (index 1)
  assert.match(summaryCell(out, 'Q20'), /SUM\(O20:P20,H6\)/);
  assert.doesNotMatch(summaryCell(out, 'Q20'), /N6|N20/);
  assert.match(summaryCell(out, 'N6'), /'S50'!S24/);
  assert.match(summaryCell(out, 'H6'), /'S50'!BG24/); // SP ของ SIM (BF+1)
  assert.match(summaryCell(out, 'D6'), /'S50'!AA24/); // CP/PI ของ SIM แสดงแยก (Z+1)
});

test('สรุป SIM แยกตามหน้าที่: แสดงทุก duty แต่ไม่ปนกับชั่วโมงเครื่องจริง', () => {
  setAircraft(config);
  const t = sumFlights(flights());
  const byDuty = simDutyBreakdown(t);
  assert.equal(byDuty['CP/PI'], 1.2);
  assert.equal(byDuty.SP, 0.5);
  assert.equal(byDuty.IP, undefined);
  assert.equal(Object.values(byDuty).reduce((a, b) => a + b, 0), 1.7); // เฉพาะ SIM
  assert.equal(t.hours, 2.5); // เครื่องจริง 2.0 + SIM SP 0.5
  setAircraft(DEFAULT_AIRCRAFT);
});

test('Summary: ยอดรวมตามหน้าที่ (แถว 20) หักแถว SIM ออกทั้งแถว', () => {
  const out = rebuildSummary(summaryXml(), DEFAULT_AIRCRAFT);
  assert.match(summaryCell(out, 'D20'), /SUM\(D5:D19\)-D12/);
  assert.match(summaryCell(out, 'H20'), /SUM\(H5:H19\)-H12/);
  const moved = rebuildSummary(summaryXml(), [
    { id: 'a', name: 'AW139', kind: 'multi', duties: ['CP/PI'] },
    { id: 's', name: 'SIM', kind: 'sim', duties: ['CP/PI', 'SP'] },
  ]);
  assert.match(summaryCell(moved, 'D20'), /SUM\(D5:D19\)-D6/);
  assert.match(summaryCell(moved, 'H20'), /SUM\(H5:H19\)-H6/);
});

test('sanitizeFlight ไม่พังเมื่อ Array.map ส่ง index เข้ามาเป็น argument ที่สอง', () => {
  setAircraft(config);
  const source = [
    { id: 'a', date: '2026-01-01', type: 'AW139', aircraftId: 'ac_aw139', duty: 'CP/PI', hours: 1.0 },
    { id: 'b', date: '2026-01-02', type: 'SIM', aircraftId: 'sim_1', duty: 'SP', hours: 0.5 },
  ];
  const cleaned = source.map(sanitizeFlight); // จำลอง bug เดิมใน app.js
  assert.equal(cleaned.length, 2);
  assert.ok(cleaned[0]);
  assert.ok(cleaned[1]);
  assert.equal(cleaned[1].aircraftId, 'sim_1');
  setAircraft(DEFAULT_AIRCRAFT);
});
