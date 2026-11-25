// logic.js — ตรรกะล้วน ไม่แตะ DOM / Firebase (ทดสอบด้วย Node ได้)

export const DUTIES = ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'];
// รายการภารกิจ (สะกด Flight Training ให้ถูกต้อง; ข้อมูลเก่าที่สะกด Trainning ยังนำเข้าได้)
export const MISSIONS = ['Ferry Flight', 'Parachute', 'Air Transportation', 'Air Medivac', 'Flight Training', 'Special Operation', 'Standardization', 'Other', 'VVIP', 'VIP'];

// ---------- Aircraft Configuration v2 ----------
// Stable IDs are primary keys; names remain as compatibility/display fields.
export const MAX_AIRCRAFT = Infinity; // App data is not limited by the legacy 8-slot Excel template.
export const KIND_LABEL = { single: 'เครื่องยนต์เดียว', multi: 'หลายเครื่องยนต์', sim: 'เครื่องฝึกบินจำลอง (SIM)' };
export const KIND_SHORT = { single: 'เครื่องยนต์เดียว', multi: 'หลายเครื่องยนต์', sim: 'เครื่องฝึกจำลอง' };
const LEGACY_DEFAULTS = [
  { name: 'AW139', kind: 'multi', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP'] },
  { name: 'AW149', kind: 'multi', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP'] },
  { name: 'AS550', kind: 'single', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP'] },
  { name: 'BELL212', kind: 'multi', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP'] },
  { name: 'UH1', kind: 'single', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP'] },
  { name: 'H269', kind: 'single', duties: ['CP/PI', 'PC', 'SOLO'] },
  { name: 'EN48', kind: 'single', duties: ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'] },
  { name: 'SIM', kind: 'sim', duties: ['CP/PI', 'PC', 'IP', 'SP'] },
];
const slugId = (name) => `ac_${String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unknown'}`;
export const DEFAULT_AIRCRAFT = LEGACY_DEFAULTS.map((a) => ({ ...a, id: slugId(a.name), active: true }));
export const AIRCRAFT = [];
export const SINGLE = new Set();
export const MULTI = new Set();
export const SIMS = new Set();
export const AIRCRAFT_BY_ID = new Map();
export const AIRCRAFT_BY_NAME = new Map();

export function normalizeAircraft(list = []) {
  const used = new Set();
  return list.map((a, i) => {
    const name = String(a?.name ?? '').trim().toUpperCase();
    let id = String(a?.id || slugId(name));
    if (used.has(id)) id = `${id}_${i + 1}`;
    used.add(id);
    const legacyDuties = LEGACY_DEFAULTS.find((x) => x.name === name)?.duties || DUTIES;
    const duties = [...new Set((Array.isArray(a?.duties) ? a.duties : legacyDuties).map((d) => String(d).trim().toUpperCase()).filter((d) => DUTIES.includes(d)))];
    return { id, name, kind: ['single', 'multi', 'sim'].includes(a?.kind) ? a.kind : 'single', duties, active: a?.active !== false, sortOrder: Number.isFinite(Number(a?.sortOrder)) ? Number(a.sortOrder) : i + 1 };
  });
}

export function setAircraft(list) {
  const normalized = normalizeAircraft(list);
  AIRCRAFT.length = 0; SINGLE.clear(); MULTI.clear(); SIMS.clear(); AIRCRAFT_BY_ID.clear(); AIRCRAFT_BY_NAME.clear();
  for (const a of normalized) {
    AIRCRAFT.push(a.name);
    AIRCRAFT_BY_ID.set(a.id, a);
    AIRCRAFT_BY_NAME.set(a.name, a);
    (a.kind === 'multi' ? MULTI : a.kind === 'sim' ? SIMS : SINGLE).add(a.name);
  }
  return normalized;
}
export const kindOf = (name) => (MULTI.has(name) ? 'multi' : SIMS.has(name) ? 'sim' : 'single');
export const getAircraft = () => AIRCRAFT.map((name) => ({ ...(AIRCRAFT_BY_NAME.get(name) || {}), name, kind: kindOf(name) }));
export const aircraftByName = (name) => AIRCRAFT_BY_NAME.get(String(name || '').trim().toUpperCase()) || null;
export const aircraftById = (id) => AIRCRAFT_BY_ID.get(String(id || '')) || null;
export const dutiesForAircraft = (typeOrId) => {
  const a = AIRCRAFT_BY_ID.get(String(typeOrId || '')) || AIRCRAFT_BY_NAME.get(String(typeOrId || '').trim().toUpperCase());
  return a ? [...a.duties] : [...DUTIES];
};
export const sameAircraft = (a, b) => { const aa = normalizeAircraft(a); const bb = normalizeAircraft(b); return aa.length === bb.length && aa.every((x, i) => x.id === bb[i].id && x.name === bb[i].name && x.kind === bb[i].kind && x.active === bb[i].active && x.sortOrder === bb[i].sortOrder && JSON.stringify(x.duties) === JSON.stringify(bb[i].duties)); };
export const isDefaultAircraft = (list) => sameAircraft(normalizeAircraft(list), DEFAULT_AIRCRAFT);
setAircraft(DEFAULT_AIRCRAFT);

export const NAME_RE = /^[A-Z0-9][A-Z0-9 ._\/-]{0,11}$/;
export function validateAircraft(list) {
  if (!list.length) return 'ต้องมีแบบอากาศยานอย่างน้อย 1 แบบ';
  if (!list.some((a) => a.active !== false)) return 'ต้องเปิดใช้งาน Aircraft อย่างน้อย 1 แบบ';
  const seen = new Set();
  const ids = new Set();
  for (const a of list) {
    if (!a.name) return 'มีแถวที่ยังไม่ได้ใส่ชื่อ';
    if (!NAME_RE.test(a.name)) return `ชื่อ “${a.name}” ใช้ไม่ได้ — ใช้ตัวอักษร A–Z ตัวเลข และ - . / เว้นวรรค ได้ไม่เกิน 12 ตัว`;
    if (seen.has(a.name)) return `ชื่อ “${a.name}” ซ้ำกัน`;
    seen.add(a.name);
    if (a.id && ids.has(a.id)) return `รหัส Aircraft “${a.id}” ซ้ำกัน`;
    if (a.id) ids.add(a.id);
    if (!['single', 'multi', 'sim'].includes(a.kind)) return `เลือกชนิดเครื่องยนต์ของ ${a.name}`;
    if (!Array.isArray(a.duties) || !a.duties.length || a.duties.some((d) => !DUTIES.includes(d))) return `กำหนด Flight Duty ของ ${a.name} ให้ถูกต้อง`;
  }
  return '';
}

// Legacy workbook slot mapping is retained only for Excel compatibility checks.
export function slotDuties(i) { return DEFAULT_AIRCRAFT[i]?.duties || ['CP/PI']; }
export function soloAircraftNames() { return new Set(getAircraft().filter((a) => a.duties.includes('SOLO')).map((a) => a.name)); }
export function isSoloAllowed(type) { return dutiesForAircraft(type).includes('SOLO'); }

// A value is valid only when it is an exact 0.1-hour increment (within FP tolerance).
export function hoursToTenths(value) {
  const n = num(value);
  if (!Number.isFinite(n) || n < 0) return null;
  const scaled = n * 10;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) <= 1e-8 ? rounded : null;
}
export const isValidHourIncrement = (value, { allowZero = false, max = Infinity } = {}) => {
  const n = num(value);
  return (allowZero || n > 0) && n <= max && hoursToTenths(n) !== null;
};
const addHours = (a, b) => ((hoursToTenths(a) ?? 0) + (hoursToTenths(b) ?? 0)) / 10;

export function coverageGaps(flights, opening = null) {
  let n = 0;
  const supported = (type, duty) => { const a = aircraftById(type) || aircraftByName(type); return !!a && a.duties.includes(duty); };
  for (const f of flights) if (!supported(f.aircraftId || f.type, f.duty)) n++;
  const checked = new Set();
  for (const [key, value] of Object.entries(opening?.byTypeDuty || {})) {
    if (num(value) <= 0) continue;
    const split = key.lastIndexOf('|'); const type = key.slice(0, split); const duty = key.slice(split + 1);
    const a = aircraftByName(type); if (a) checked.add(`${a.id}|${duty}`);
    if (!supported(type, duty)) n++;
  }
  for (const [id, duties] of Object.entries(opening?.byAircraftDuty || {})) for (const [duty, value] of Object.entries(duties || {})) {
    if (num(value) > 0 && !checked.has(`${id}|${duty}`) && !supported(id, duty)) n++;
  }
  return n;
}

// Coverage of the current fixed 8-slot Excel template (not the flexible app configuration).
export function excelCoverageGaps(flights, opening = null, aircraft = getAircraft()) {
  const indexByName = new Map(aircraft.map((a, i) => [a.name, i]));
  const indexById = new Map(aircraft.map((a, i) => [a.id, i]));
  const supports = (typeOrId, duty) => {
    const i = indexById.has(typeOrId) ? indexById.get(typeOrId) : indexByName.get(typeOrId);
    if (i == null || i >= 8) return false;
    if (['CP/PI', 'PC', 'MP', 'IP', 'SP'].includes(duty)) return true;
    return duty === 'SOLO' && (i === 5 || i === 6);
  };
  let count = flights.filter((f) => !supports(f.aircraftId || f.type, f.duty)).length;
  const covered = new Set();
  for (const [key, value] of Object.entries(opening?.byTypeDuty || {})) {
    if (num(value) <= 0) continue;
    const split = key.lastIndexOf('|'); const type = key.slice(0, split); const duty = key.slice(split + 1);
    const i = indexByName.get(type); if (i != null) covered.add(`${aircraft[i].id}|${duty}`);
    if (!supports(type, duty)) count++;
  }
  for (const [id, duties] of Object.entries(opening?.byAircraftDuty || {})) {
    for (const [duty, value] of Object.entries(duties || {})) if (num(value) > 0 && !covered.has(`${id}|${duty}`) && !supports(id, duty)) count++;
  }
  return count;
}

export const PAGE_SIZE = 18;

// ช่อง "สภาพการบิน" ที่เก็บเป็นชั่วโมง
export const CONDS = [
  { key: 'xc', label: 'X-Country' },
  { key: 'nightUn', label: 'Night Un-aided' },
  { key: 'nvg', label: 'Night NVG' },
  { key: 'ifr', label: 'IFR Training' },
  { key: 'imc', label: 'IMC' },
];

export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function fmt(x) {
  const tenths = hoursToTenths(x);
  if (tenths !== null) return (tenths / 10).toFixed(1);
  const r = Number(num(x).toPrecision(15));
  return new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 }).format(r);
}

export function emptyTotals() {
  return { hours: 0, single: 0, multi: 0, sim: 0, xc: 0, nightUn: 0, nvg: 0, ifr: 0, imc: 0, byType: {}, byTypeDuty: {}, byAircraftDuty: {} };
}

export function addFlight(t, f) {
  const h10 = hoursToTenths(f.hours);
  if (h10 === null || h10 <= 0 || h10 > 240) return t;
  const h = h10 / 10;
  t.hours = addHours(t.hours, h);
  if (SINGLE.has(f.type)) t.single = addHours(t.single, h);
  if (MULTI.has(f.type)) t.multi = addHours(t.multi, h);
  if (SIMS.has(f.type)) t.sim = addHours(t.sim, h);
  for (const c of CONDS) t[c.key] = addHours(t[c.key], num(f[c.key]));
  t.byType[f.type] = addHours(t.byType[f.type] || 0, h);
  const k = `${f.type}|${f.duty}`;
  t.byTypeDuty[k] = addHours(t.byTypeDuty[k] || 0, h);
  if (f.aircraftId) { t.byAircraftDuty[f.aircraftId] ||= {}; t.byAircraftDuty[f.aircraftId][f.duty] = addHours(t.byAircraftDuty[f.aircraftId][f.duty] || 0, h); }
  return t;
}

export function addTotals(a, b) {
  const t = emptyTotals();
  for (const k of ['hours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc']) t[k] = addHours(num(a?.[k]), num(b?.[k]));
  t._dataIssues = [...(a?._dataIssues || []), ...(b?._dataIssues || [])];
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src?.byType || {})) t.byType[k] = addHours(t.byType[k] || 0, num(v));
    for (const [k, v] of Object.entries(src?.byTypeDuty || {})) t.byTypeDuty[k] = addHours(t.byTypeDuty[k] || 0, num(v));
    for (const [id, duties] of Object.entries(src?.byAircraftDuty || {})) {
      t.byAircraftDuty[id] ||= {};
      for (const [duty, value] of Object.entries(duties || {})) t.byAircraftDuty[id][duty] = addHours(t.byAircraftDuty[id][duty] || 0, num(value));
    }
  }
  return t;
}

// ยอดยกมา (Opening balance) = ค่าที่พิมพ์ไว้ใน "Total Last Page" ของชีต S1
// แถวนี้ในไฟล์: I=ชม.รวม J=Single K=Multi L..S=แบบอากาศยาน T..X=สภาพการบิน Z..BM=แบบ x หน้าที่ BN..BO=SOLO
const DUTY_BLOCKS = [
  ['CP/PI', 25, 8],
  ['PC', 33, 8],
  ['MP', 41, 8],
  ['IP', 49, 8],
  ['SP', 57, 8],
];
// SOLO มีแค่ 2 คอลัมน์: BN=ช่อง5 (H269), BO=ช่อง6 (EN48) — index 0-based ของแถว = 65, 66
const SOLO_OPENING = [[65, 5], [66, 6]];
// names = ชื่อแบบของแต่ละช่องในไฟล์ (ค่าเริ่มต้น = รายการปัจจุบัน)
export function parseOpening(row, names = AIRCRAFT) {
  const t = emptyTotals();
  const n = (i) => num(row[i]);
  t.hours = n(8); t.single = n(9); t.multi = n(10);
  names.forEach((a, i) => { if (a && i < 8 && n(11 + i)) t.byType[a] = n(11 + i); });
  t.xc = n(19); t.nightUn = n(20); t.nvg = n(21); t.ifr = n(22); t.imc = n(23);
  for (const [duty, start, count] of DUTY_BLOCKS) {
    for (let i = 0; i < count; i++) {
      const v = n(start + i);
      if (v && names[i]) { t.byTypeDuty[`${names[i]}|${duty}`] = v; const a = aircraftByName(names[i]); if (a) { t.byAircraftDuty[a.id] ||= {}; t.byAircraftDuty[a.id][duty] = v; } }
    }
  }
  for (const [col, slot] of SOLO_OPENING) {
    const v = n(col);
    if (v && names[slot]) { t.byTypeDuty[`${names[slot]}|SOLO`] = v; const a = aircraftByName(names[slot]); if (a) { t.byAircraftDuty[a.id] ||= {}; t.byAircraftDuty[a.id].SOLO = v; } }
  }
  t.sim = Object.entries(t.byType).reduce((a, [k, v]) => a + (SIMS.has(k) ? v : 0), 0);
  return t;
}

// เดาชนิดเครื่องยนต์จากชื่อ (ใช้เมื่อไม่มีข้อมูลอื่น)
export const guessKind = (name) => (/^(SIM|FFS|FTD|FNPT)/i.test(name) ? 'sim' : 'single');

// ชื่อแบบอากาศยานของแต่ละช่อง (8 ช่อง) จากหัวคอลัมน์ L3:S3 ของชีตแรกในไฟล์ Excel (ช่องว่าง = '')
// ws = อ็อบเจกต์ชีตของ SheetJS (เข้าถึงด้วยชื่อเซลล์ เช่น ws.L3.v, ws.J4.f)
export function sheetSlotNames(ws) {
  return ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].map((c) => String(ws?.[`${c}3`]?.v ?? '').trim().toUpperCase());
}

// รายการแบบอากาศยานในไฟล์ + ชนิดเครื่องยนต์ (อ่านจากสูตรช่อง Single/Multi)
export function sheetAircraft(ws) {
  const quoted = (f) => [...String(f || '').matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().toUpperCase());
  const single = new Set(quoted(ws?.J4?.f));
  const multi = new Set([...quoted(ws?.K4?.f), ...quoted(ws?.K5?.f)]);
  return sheetSlotNames(ws).filter(Boolean).map((name) => ({
    name,
    kind: multi.has(name) ? 'multi' : single.has(name) ? 'single' : guessKind(name),
  }));
}

export function sumFlights(list) {
  const t = emptyTotals();
  for (const f of list) addFlight(t, f);
  return t;
}

// เรียงตามลำดับที่กรอก (เหมือนสมุดล็อกบุ๊ก) — ข้อมูลนำเข้าคงลำดับเดิมของไฟล์ Excel, เที่ยวใหม่ต่อท้าย
export function sortFlights(list) {
  return [...list].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// หาค่า ord ให้เที่ยวบินใหม่ เพื่อแทรกตามวันที่ (หลังเที่ยวสุดท้ายที่วันที่ <= วันที่นี้)
// sorted = รายการที่เรียงตาม ord แล้ว (ไม่รวมเที่ยวที่กำลังแก้)
export function slotOrd(sorted, date) {
  if (!sorted.length) return Date.now();
  let at = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].date <= date) { at = i; break; }
  }
  const last = sorted.length - 1;
  if (at === last) return Math.max(Date.now(), (sorted[last].ord ?? 0) + 1);
  if (at === -1) return (sorted[0].ord ?? 0) - 1;
  return ((sorted[at].ord ?? 0) + (sorted[at + 1].ord ?? 0)) / 2;
}

// ระยะห่าง ord ระหว่างเที่ยวบิน (เว้นไว้ให้แทรกกลางได้หลายครั้งก่อนต้องจัดเลขใหม่)
export const ORD_STEP = 1048576;

// ช่องที่จะแทรกแคบเกินไปหรือไม่ (ทศนิยม ord ใกล้หมดความละเอียด) → ต้อง renumber ก่อนแทรก
export function slotGapTooSmall(sorted, date) {
  let at = -1;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].date <= date) { at = i; break; }
  if (at < 0 || at === sorted.length - 1) return false;
  return (sorted[at + 1].ord ?? 0) - (sorted[at].ord ?? 0) < 1e-3;
}

// จัดเลข ord ใหม่ให้ห่างเท่ากัน (คงลำดับเดิม)
export function renumber(sorted) {
  return sorted.map((f, i) => ({ ...f, ord: i * ORD_STEP }));
}

// จำนวนรายการที่วันที่ย้อนกลับเมื่อเทียบกับรายการก่อนหน้า
export function countOutOfOrder(sorted) {
  let n = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].date < sorted[i - 1].date) n++;
  return n;
}

// เรียงใหม่ตามวันที่ (คงลำดับเดิมของเที่ยวที่วันเดียวกัน) → คืนเฉพาะรายการที่ ord เปลี่ยน
export function reorderByDate(sorted) {
  const byDate = sorted
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.date < b.f.date ? -1 : a.f.date > b.f.date ? 1 : a.i - b.i))
    .map((x) => x.f);
  const changed = [];
  byDate.forEach((f, i) => { if (f.ord !== i * ORD_STEP) changed.push({ ...f, ord: i * ORD_STEP }); });
  return changed;
}

// แบ่งเป็นหน้า (หน้าละ 18 รายการ) พร้อมยอด This Page / Last Page / Forward
// หน้าแรกใช้ยอดยกมา (opening) เป็น Last Page
export function paginate(sorted, opening = null) {
  const pages = [];
  let forward = addTotals(opening, null);
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    const rows = sorted.slice(i, i + PAGE_SIZE).map((f, j) => ({ ...f, no: i + j + 1 }));
    const thisPage = sumFlights(rows);
    const last = forward;
    forward = addTotals(last, thisPage);
    pages.push({ n: pages.length + 1, rows, thisPage, last, forward });
  }
  return pages;
}

// ---------- วันที่ ----------
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

// ---------- นำเข้าจาก Excel (แถว = array ตามคอลัมน์ A=0) ----------
// serial → ISO โดยไม่พึ่งเขตเวลา
export function serialToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

// วันที่ที่พิมพ์เป็นข้อความใน Excel: 2024-06-12, 12/06/2024, 12-6-24 (ปีพุทธศักราชแปลงให้) → ISO หรือ ''
export function parseDateText(str) {
  const t = String(str ?? '').trim();
  let y, m, d;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t))) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  else return '';
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function rowToFlight(row) {
  const dateRaw = row[1];
  let hours = row[8];
  if (typeof hours === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(hours)) hours = num(hours);
  if (typeof hours !== 'number' || !(hours > 0)) return null;
  // เก็บค่าต้นฉบับไว้ตรวจสอบ; sanitizeFlight จะทำเครื่องหมายค่าที่ไม่ใช่ 0.1 ชั่วโมง
  let date = '';
  if (typeof dateRaw === 'number') date = dateRaw > 0 ? serialToISO(dateRaw) : '';
  else if (dateRaw instanceof Date) date = dateRaw.toISOString().slice(0, 10);
  else if (typeof dateRaw === 'string') date = parseDateText(dateRaw);
  if (!date) return null;
  const type = clean(row[2]).toUpperCase().slice(0, 12);
  if (!type) return null;
  // รับทั้ง number และ string ตัวเลขจาก Excel (เช่น "1.5")
  const n = (v) => Math.max(0, num(v));
  // หมายเหตุ: แม่แบบ v1.1+ = BP (index 67), รุ่นก่อน = BE (index 56), เก่าสุด = BC (index 54)
  const note = clean(row[67]) || clean(row[56]) || clean(row[54]);
  let mission = clean(row[6]);
  if (/^flight\s*trainni?ng$/i.test(mission)) mission = 'Flight Training'; // แก้สะกดเดิมในไฟล์
  return {
    date,
    type,
    aircraftId: aircraftByName(type)?.id || null,
    number: clean(row[3]),
    dep: clean(row[4]),
    dest: clean(row[5]),
    mission,
    duty: clean(row[7]),
    hours,
    xc: n(row[19]),
    nightUn: n(row[20]),
    nvg: n(row[21]),
    ifr: n(row[22]),
    imc: n(row[23]),
    note,
  };
}

// แถวข้อมูลในช่วงแถว 4–21 ที่มีเนื้อหาแต่ rowToFlight อ่านไม่ได้ (เช่น วันที่เป็นข้อความที่แปลงไม่ได้ หรือไม่มีแบบอากาศยาน)
export function isUnreadableDataRow(row, rowIndex) {
  return rowIndex >= 3 && rowIndex <= 20 && (num(row[8]) > 0 || clean(row[2]) !== '' || row[1] != null) && !rowToFlight(row);
}

// ล้างข้อมูลจากไฟล์สำรอง/ภายนอก: เก็บเฉพาะฟิลด์ที่รู้จัก ตัวเลขเป็นตัวเลข ข้อความจำกัดความยาว
export function sanitizeFlight(f) {
  if (!f || typeof f !== 'object') return null;
  const id = String(f.id ?? '').slice(0, 64);
  const date = String(f.date ?? '');
  let type = String(f.type ?? '').trim().toUpperCase().slice(0, 12);
  const hours = num(f.hours);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !type || !(hours > 0) || hours > 24) return null;
  const txt = (v, max) => String(v ?? '').trim().slice(0, max);
  const dutyRaw = txt(f.duty, 120);
  const dutyUpper = dutyRaw.toUpperCase();
  const duty = DUTIES.includes(dutyUpper) ? dutyUpper : dutyRaw; // Preserve unknown/legacy duty text exactly; never coerce to CP/PI.
  const matched = f.aircraftId ? aircraftById(f.aircraftId) : aircraftByName(type);
  const issues = Array.isArray(f._dataIssues) ? f._dataIssues.filter((item) => !(matched && item.code === 'UNKNOWN_AIRCRAFT') && !(matched?.duties.includes(duty) && item.code === 'UNCONFIGURED_DUTY')) : [];
  if (!isValidHourIncrement(hours, { max: 24 })) issues.push({ code: 'INVALID_HOUR_PRECISION', field: 'hours', value: hours });
  if (!duty) issues.push({ code: 'MISSING_DUTY', field: 'duty', value: duty });
  else if (!DUTIES.includes(duty)) issues.push({ code: 'LEGACY_DUTY', field: 'duty', value: duty });
  if (matched && !matched.duties.includes(duty)) issues.push({ code: 'UNCONFIGURED_DUTY', field: 'duty', value: duty });
  if (!matched) issues.push({ code: 'UNKNOWN_AIRCRAFT', field: f.aircraftId ? 'aircraftId' : 'type', value: f.aircraftId || type });
  for (const c of CONDS) { const value = Math.max(0, num(f[c.key])); if (value > 0 && !isValidHourIncrement(value, { max: 24 })) issues.push({ code: 'INVALID_HOUR_PRECISION', field: c.key, value }); }
  let mission = txt(f.mission, 120);
  if (/^flight\s*trainni?ng$/i.test(mission)) mission = 'Flight Training';
  const out = {
    id, date, type, aircraftId: matched?.id || (f.aircraftId ? txt(f.aircraftId, 80) : null), hours,
    number: txt(f.number, 20), dep: txt(f.dep, 120), dest: txt(f.dest, 120),
    mission, duty, note: txt(f.note, 500),
    ord: Number.isFinite(Number(f.ord)) ? Number(f.ord) : 0,
  };
  for (const c of CONDS) {
    const v = Math.max(0, num(f[c.key]));
    out[c.key] = Math.min(v, hours);
  }
  if (issues.length) out._dataIssues = issues.filter((item, index, all) => all.findIndex((x) => x.code === item.code && x.field === item.field && x.value === item.value) === index);
  return out;
}

export function sanitizeOpening(o) {
  if (!o || typeof o !== 'object') return null;
  const t = emptyTotals();
  const invalid = Array.isArray(o._dataIssues) ? [...o._dataIssues] : [];
  for (const k of ['hours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc']) {
    const value = Math.max(0, num(o[k]));
    if (!isValidHourIncrement(value, { allowZero: true })) invalid.push({ code: 'INVALID_HOUR_PRECISION', field: k, value });
    else t[k] = value;
  }
  for (const key of ['byType', 'byTypeDuty']) {
    for (const [k, v] of Object.entries(o[key] && typeof o[key] === 'object' ? o[key] : {})) {
      const value = num(v);
      if (String(k).length > 120 || value <= 0) continue;
      if (!isValidHourIncrement(value, { allowZero: false })) invalid.push({ code: 'INVALID_HOUR_PRECISION', field: `${key}.${k}`, value });
      else t[key][k] = value;
    }
  }
  for (const [id, duties] of Object.entries(o.byAircraftDuty && typeof o.byAircraftDuty === 'object' ? o.byAircraftDuty : {})) {
    for (const [duty, raw] of Object.entries(duties || {})) {
      const value = num(raw);
      if (value <= 0) continue;
      if (!isValidHourIncrement(value, { allowZero: false })) invalid.push({ code: 'INVALID_HOUR_PRECISION', field: `byAircraftDuty.${id}.${duty}`, value });
      else { t.byAircraftDuty[id] ||= {}; t.byAircraftDuty[id][duty] = value; }
    }
  }
  if (invalid.length) t._dataIssues = invalid;
  return t;
}

// Pure prepare phase for v1 -> v2 migration. It never writes to storage.
// The caller must show this preview and obtain confirmation before committing.
export function prepareMigrationV2({ aircraft = DEFAULT_AIRCRAFT, flights = [], opening = null } = {}) {
  const config = normalizeAircraft(aircraft);
  const byName = new Map(config.map((a) => [a.name, a]));
  const migratedFlights = flights.map((source) => {
    const f = sanitizeFlight(source);
    if (!f) return { source, migrated: null, issue: 'UNREADABLE_FLIGHT' };
    const a = f.aircraftId ? config.find((item) => item.id === f.aircraftId) : byName.get(f.type);
    if (a) {
      f.aircraftId = a.id;
      f._dataIssues = (f._dataIssues || []).filter((item) => item.code !== 'UNKNOWN_AIRCRAFT' && !(item.code === 'UNCONFIGURED_DUTY' && a.duties.includes(f.duty)));
      if (!a.duties.includes(f.duty) && !f._dataIssues.some((item) => item.code === 'UNCONFIGURED_DUTY')) f._dataIssues.push({ code: 'UNCONFIGURED_DUTY', field: 'duty', value: f.duty });
    } else if (!f._dataIssues?.some((item) => item.code === 'UNKNOWN_AIRCRAFT')) {
      f._dataIssues = [...(f._dataIssues || []), { code: 'UNKNOWN_AIRCRAFT', field: 'type', value: f.type }];
    }
    return { source, migrated: f, issue: null };
  });
  const oldOpening = opening ? sanitizeOpening(opening) : null;
  const byAircraftDuty = Object.fromEntries(Object.entries(oldOpening?.byAircraftDuty || {}).map(([id, duties]) => [id, { ...(duties || {}) }]));
  const unresolvedOpening = {};
  for (const [key, value] of Object.entries(oldOpening?.byTypeDuty || {})) {
    const split = key.lastIndexOf('|');
    const name = key.slice(0, split);
    const duty = key.slice(split + 1);
    const a = byName.get(name);
    if (a) {
      byAircraftDuty[a.id] ||= {};
      if (byAircraftDuty[a.id][duty] == null) byAircraftDuty[a.id][duty] = value;
    } else unresolvedOpening[key] = value;
  }
  const migratedOpening = oldOpening ? {
    ...oldOpening,
    version: 2,
    byAircraftDuty,
    _unresolvedByTypeDuty: unresolvedOpening,
    _dataIssues: [...(oldOpening._dataIssues || []), ...Object.entries(unresolvedOpening).map(([field, value]) => ({ code: 'UNKNOWN_AIRCRAFT_OPENING', field, value }))],
  } : null;
  const dataQuality = {
    invalidFlights: migratedFlights.filter((x) => !x.migrated).length,
    invalidHourFlights: migratedFlights.filter((x) => x.migrated?._dataIssues?.some((i) => i.code === 'INVALID_HOUR_PRECISION')).length,
    legacyDutyFlights: migratedFlights.filter((x) => x.migrated?._dataIssues?.some((i) => i.code === 'LEGACY_DUTY' || i.code === 'UNCONFIGURED_DUTY')).length,
    unknownAircraftFlights: migratedFlights.filter((x) => x.migrated?._dataIssues?.some((i) => i.code === 'UNKNOWN_AIRCRAFT')).length,
    unresolvedOpeningEntries: Object.keys(unresolvedOpening).length,
    openingIssues: oldOpening?._dataIssues?.length || 0,
  };
  return {
    version: 2,
    config: { version: 2, v: 2, aircraft: config },
    flights: migratedFlights,
    opening: migratedOpening,
    dataQuality,
    requiresReview: Object.values(dataQuality).some((n) => n > 0),
  };
}

export const flightKey = (f) =>
  [f.date, f.type, f.number, f.dep, f.dest, f.duty, num(f.hours)].join('|');

// ตัดรายการที่ซ้ำกับของเดิม (นับจำนวนซ้ำด้วย เที่ยวเหมือนกันสองรอบในวันเดียวกันไม่หาย)
export function filterNew(existing, incoming) {
  const seen = new Map();
  for (const f of existing) seen.set(flightKey(f), (seen.get(flightKey(f)) || 0) + 1);
  const out = [];
  for (const f of incoming) {
    const k = flightKey(f);
    if (seen.get(k) > 0) seen.set(k, seen.get(k) - 1);
    else out.push(f);
  }
  return out;
}
