import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AIRCRAFT, prepareMigrationV2, setAircraft } from '../logic.js';
import { rebuildSummary } from '../xlsxfill.js';
import { computeSyncStatus } from '../backend.js';

const snapshot = (fromCache, pending = false) => ({ fromCache, pending });

test('P0-2: sync status reflects the current snapshots and pending writes', () => {
  const fresh = {
    flights: snapshot(false),
    config: snapshot(false),
    opening: snapshot(false),
    quarantine: snapshot(false),
  };
  assert.equal(computeSyncStatus(fresh), 'synced');

  // เคยเจอ server มาก่อน แต่ snapshot ล่าสุดมาจาก cache → ต้องเป็น offline
  assert.equal(computeSyncStatus({ ...fresh, flights: snapshot(true) }), 'offline');

  // hasPendingWrites หรือ write ที่ยังไม่ ack → pending มีลำดับสูงสุด
  assert.equal(computeSyncStatus({ ...fresh, opening: snapshot(false, true) }), 'pending');
  assert.equal(computeSyncStatus(fresh, 1), 'pending');
});

test('P0-3: unreadable flights are surfaced, quarantined and never silently dropped', () => {
  setAircraft(DEFAULT_AIRCRAFT);
  const flights = [
    { id: 'ok', date: '2024-01-01', type: 'AW139', hours: 1.2, duty: 'CP/PI' },
    { id: 'bad-hours', date: '2024-01-02', type: 'AW139', hours: 25, duty: 'CP/PI' },
    { id: 'bad-date', date: 'not-a-date', type: 'AW139', hours: 1.0, duty: 'CP/PI' },
    { id: 'zero-hours', date: '2024-01-03', type: 'AW139', hours: 0, duty: 'CP/PI' },
  ];

  const preview = prepareMigrationV2({ flights });
  assert.equal(preview.dataQuality.invalidFlights, 3);
  assert.equal(preview.flights.filter((x) => x.migrated).length, 1);
  assert.equal(preview.flights.filter((x) => !x.migrated).length, 3);
  assert.equal(preview.quarantine.length, 3);
  assert.deepEqual(preview.quarantine.map((q) => q.id).sort(), ['bad-date', 'bad-hours', 'zero-hours']);
  assert.ok(preview.quarantine.every((q) => q.issue === 'UNREADABLE_FLIGHT' && q.source));
  assert.equal(preview.requiresReview, true);
});

test('P0-4: legacy Summary maps SIM/SINGLE/MULTI to N/O/P and preserves I:M', () => {
  const cols = 'BCDEFGHIJKLMNOPQ'.split('');
  let xml = '';
  for (let r = 5; r <= 7; r++) {
    xml += `<row r="${r}">${cols.map((c) => `<c r="${c}${r}"><v>0</v></c>`).join('')}</row>`;
  }
  const out = rebuildSummary(xml, [
    { id: 's1', name: 'AS550', kind: 'single', duties: ['CP/PI'] },
    { id: 'm1', name: 'AW139', kind: 'multi', duties: ['CP/PI', 'PC'] },
    { id: 'sim1', name: 'SIM', kind: 'sim', duties: ['CP/PI', 'IP'] },
  ]);
  const cell = (ref) => {
    const m = new RegExp(`<c r="${ref}"(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</c>)`).exec(out);
    return m ? m[0] : '';
  };

  assert.match(cell('D5'), /'S50'!Z24/);
  assert.match(cell('O5'), /SUM\(C5:H5\)/);       // SINGLE → O
  assert.equal(cell('N5'), '<c r="N5"/>');        // SIM คอลัมน์ต้องว่างในแถว single
  assert.match(cell('P6'), /SUM\(C6:H6\)/);       // MULTI → P
  assert.equal(cell('O6'), '<c r="O6"/>');
  assert.match(cell('N7'), /'S50'!S24/);          // SIM → N ตามแม่แบบ (ยังนับทุก duty)
  // SIM ที่ไม่ใช่ SP ไม่เข้าตาราง C:H — duty เดิม CP/PI/IP ถูกกวาดทิ้ง
  assert.equal(cell('D7'), '<c r="D7"/>');
  assert.equal(cell('G7'), '<c r="G7"/>');
  assert.equal(cell('M7'), '<c r="M7"><v>0</v></c>'); // I:M ไม่ถูกเคลียร์
});

test('P1-SIM: เฉพาะหน้าที่ SP ของ SIM ที่เข้า C:H ของ Summary', () => {
  const cols = 'BCDEFGHIJKLMNOPQ'.split('');
  let xml = '';
  for (let r = 5; r <= 7; r++) xml += `<row r="${r}">${cols.map((c) => `<c r="${c}${r}"><v>0</v></c>`).join('')}</row>`;
  const out = rebuildSummary(xml, [
    { id: 'a', name: 'AW139', kind: 'multi', duties: ['CP/PI'] },
    { id: 'm', name: 'AW149', kind: 'multi', duties: ['CP/PI'] },
    { id: 's', name: 'SIM', kind: 'sim', duties: ['CP/PI', 'IP', 'SP'] },
  ]);
  const cell = (ref) => new RegExp(`<c r="${ref}"(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</c>)`).exec(out)?.[0] || '';
  // SIM อยู่ช่องที่ 3 (index 2) → SP อยู่คอลัมน์ BF+2 = BH
  assert.match(cell('H7'), /'S50'!BH24/);
  assert.equal(cell('D7'), '<c r="D7"/>');
  assert.equal(cell('G7'), '<c r="G7"/>');
  assert.match(cell('N7'), /'S50'!S24/);
});
