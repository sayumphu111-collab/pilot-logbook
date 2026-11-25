// logic.js — ตรรกะล้วน ไม่แตะ DOM / Firebase (ทดสอบด้วย Node ได้)
// Data Model v2: aircraftId คือ primary key, ชื่อเป็น display/legacy compatibility

export const DUTIES = ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'];
// รายการภารกิจ (สะกด Flight Training ให้ถูกต้อง; ข้อมูลเก่าที่สะกด Trainning ยังนำเข้าได้)
export const MISSIONS = ['Ferry Flight', 'Parachute', 'Air Transportation', 'Air Medivac', 'Flight Training', 'Special Operation', 'Standardization', 'Other', 'VVIP', 'VIP'];

// ---------- Aircraft Configuration v2 ----------
export const MAX_AIRCRAFT = Infinity;
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

export const AIRCRAFT = [];                 // display names (legacy-facing)
export const SINGLE = new Set();            // display names (legacy-facing)
export const MULTI = new Set();             // display names (legacy-facing)
export const SIMS = new Set();              // display names (legacy-facing)
export const SINGLE_IDS = new Set();        // canonical
export const MULTI_IDS = new Set();         // canonical
export const SIM_IDS = new Set();           // canonical
export const AIRCRAFT_BY_ID = new Map();
export const AIRCRAFT_BY_NAME = new Map();

let aircraftRecords = [];
let index = { byId: new Map(), byName: new Map() };

function makeIndex(list = []) {
  const byId = new Map();
  const byName = new Map();
  for (const a of list || []) {
    if (!a) continue;
    if (!byId.has(a.id)) byId.set(a.id, a);
    if (!byName.has(a.name)) byName.set(a.name, a);
  }
  return { byId, byName };
}
const upper = (v) => String(v ?? '').trim().toUpperCase();
const resolveRef = (ref, idx = index) => idx.byId.get(String(ref ?? '')) || idx.byName.get(upper(ref)) || null;

export function normalizeAircraft(list = []) {
  const used = new Set();
  return list.map((a, i) => {
    const name = upper(a?.name);
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
  aircraftRecords = normalized;
  index = makeIndex(normalized);
  AIRCRAFT.length = 0;
  SINGLE.clear(); MULTI.clear(); SIMS.clear();
  SINGLE_IDS.clear(); MULTI_IDS.clear(); SIM_IDS.clear();
  AIRCRAFT_BY_ID.clear(); AIRCRAFT_BY_NAME.clear();
  for (const a of normalized) {
    AIRCRAFT.push(a.name);
    AIRCRAFT_BY_ID.set(a.id, a);
    AIRCRAFT_BY_NAME.set(a.name, a);
    (a.kind === 'multi' ? MULTI : a.kind === 'sim' ? SIMS : SINGLE).add(a.name);
    (a.kind === 'multi' ? MULTI_IDS : a.kind === 'sim' ? SIM_IDS : SINGLE_IDS).add(a.id);
  }
  return normalized;
}
export const getAircraft = () => aircraftRecords.map((a) => ({ ...a }));
export const kindOf = (name) => resolveRef(name)?.kind || (SIMS.has(upper(name)) ? 'sim' : MULTI.has(upper(name)) ? 'multi' : 'single');
export const aircraftByName = (name) => AIRCRAFT_BY_NAME.get(upper(name)) || null;
export const aircraftById = (id) => AIRCRAFT_BY_ID.get(String(id ?? '')) || null;

// P1-1: resseolve ด้วย id ก่อนเสมอ; unknown id ห้าม rebind ด้วยชื่อ (กัน record สวม identity)
export function resolveAircraft(f, idx = index) {
  const id = String(f?.aircraftId ?? '').trim();
  if (id) return idx.byId.get(id) || null;
  return resolveRef(f?.type, idx);
}
function typeKey(f, idx = index) {
  return resolveAircraft(f, idx)?.id || upper(f?.type) || 'UNKNOWN';
}

export const dutiesForAircraft = (typeOrId) => {
  const a = AIRCRAFT_BY_ID.get(String(typeOrId ?? '')) || AIRCRAFT_BY_NAME.get(upper(typeOrId));
  return a ? [...a.duties] : [...DUTIES];
};
export const sameAircraft = (a, b) => {
  const aa = normalizeAircraft(a); const bb = normalizeAircraft(b);
  return aa.length === bb.length && aa.every((x, i) => x.id === bb[i].id && x.name === bb[i].name && x.kind === bb[i].kind && x.active === bb[i].active && x.sortOrder === bb[i].sortOrder && JSON.stringify(x.duties) === JSON.stringify(bb[i].duties));
};
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

// Legacy Excel slot mapping is retained only for Excel compatibility checks.
export function slotDuties(i) { return DEFAULT_AIRCRAFT[i]?.duties || ['CP/PI']; }
export function soloAircraftNames() { return new Set(getAircraft().filter((a) => a.duties.includes('SOLO')).map((a) => a.name)); }
export const isSoloAllowed = (type) => dutiesForAircraft(type).includes('SOLO');

// ---------- ชั่วโมง ----------
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

// P1-SIM: SIM เป็นชั่วโมงบินจริงเฉพาะหน้าที่ SP; นอกนั้นยังอยู่ใน sim/loggedHours แต่ไม่เข้า hours
export const isSimFlight = (f, idx = index) => resolveAircraft(f, idx)?.kind === 'sim';
export const isRealFlight = (f, idx = index) => !isSimFlight(f, idx) || upper(f?.duty) === 'SP';

export function coverageGaps(flights, opening = null, aircraftList = null) {
  const idx = makeIndex(aircraftList || aircraftRecords);
  const supported = (ref, duty) => { const a = resolveRef(ref, idx); return !!a && a.duties.includes(duty); };
  let n = 0;
  for (const f of flights) if (!supported(resolveAircraft(f, idx)?.id, f.duty)) n++;
  const checked = new Set();
  for (const [key, value] of Object.entries(opening?.byTypeDuty || {})) {
    if (num(value) <= 0) continue;
    const split = key.lastIndexOf('|'); const ref = key.slice(0, split); const duty = key.slice(split + 1);
    const a = resolveRef(ref, idx); if (a) checked.add(`${a.id}|${duty}`);
    if (!supported(ref, duty)) n++;
  }
  for (const [id, duties] of Object.entries(opening?.byAircraftDuty || {})) for (const [duty, value] of Object.entries(duties || {})) {
    if (num(value) > 0 && !checked.has(`${id}|${duty}`) && !supported(id, duty)) n++;
  }
  return n;
}

// Coverage ของแม่แบบ 8 ช่องจริง (ไม่ใช่ config ที่ยืดหยุ่น)
export function excelCoverageGaps(flights, opening = null, aircraft = getAircraft()) {
  const idx = makeIndex(aircraft);
  const indexByName = new Map(aircraft.map((a, i) => [a.name, i]));
  const indexById = new Map(aircraft.map((a, i) => [a.id, i]));
  const supports = (ref, duty) => {
    const i = indexById.has(ref) ? indexById.get(ref) : indexByName.get(upper(ref));
    if (i == null || i >= 8) return false;
    if (['CP/PI', 'PC', 'MP', 'IP', 'SP'].includes(duty)) return true;
    return duty === 'SOLO' && (i === 5 || i === 6);
  };
  let count = flights.filter((f) => !supports(resolveAircraft(f, idx)?.id, f.duty)).length;
  const covered = new Set();
  for (const [key, value] of Object.entries(opening?.byTypeDuty || {})) {
    if (num(value) <= 0) continue;
    const split = key.lastIndexOf('|'); const ref = key.slice(0, split); const duty = key.slice(split + 1);
    const a = resolveRef(ref, idx); if (a) covered.add(`${a.id}|${duty}`);
    if (!supports(ref, duty)) count++;
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
  // hours = ชั่วโมงบินจริง (SIM นอก SP ตัดออก), loggedHours = ชั่วโมงที่กรอกทั้งหมด (ยังใช้แยก SIM)
  return {
    hours: 0, loggedHours: 0, single: 0, multi: 0, sim: 0,
    xc: 0, nightUn: 0, nvg: 0, ifr: 0, imc: 0,
    byType: {}, byTypeDuty: {}, byAircraftDuty: {},
  };
}

export function addFlight(t, f, idx = index) {
  const h10 = hoursToTenths(f.hours);
  if (h10 === null || h10 <= 0 || h10 > 240) return t;
  const h = h10 / 10;
  const a = resolveAircraft(f, idx);
  const key = typeKey(f, idx);

  t.loggedHours = addHours(t.loggedHours, h);
  if (isRealFlight(f, idx)) t.hours = addHours(t.hours, h);
  if (a?.kind === 'single') t.single = addHours(t.single, h);
  if (a?.kind === 'multi') t.multi = addHours(t.multi, h);
  if (a?.kind === 'sim') t.sim = addHours(t.sim, h);
  for (const c of CONDS) t[c.key] = addHours(t[c.key], num(f[c.key]));

  t.byType[key] = addHours(t.byType[key] || 0, h);
  const k = `${key}|${f.duty ?? ''}`;
  t.byTypeDuty[k] = addHours(t.byTypeDuty[k] || 0, h);
  if (a?.id) {
    t.byAircraftDuty[a.id] ||= {};
    t.byAircraftDuty[a.id][f.duty ?? ''] = addHours(t.byAircraftDuty[a.id][f.duty ?? ''] || 0, h);
  }
  return t;
}

export function addTotals(a, b) {
  const t = emptyTotals();
  for (const k of ['hours', 'loggedHours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc']) t[k] = addHours(num(a?.[k]), num(b?.[k]));
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

// สรุปชั่วโมง SIM แยกตามหน้าที่ (ไม่ปนกับชั่วโมงบินของเครื่องจริง)
// ใช้แสดงในหน้าสรุปของแอป; SP ยังคงเป็นชั่วโมงบินจริงตาม isRealFlight
export function simDutyBreakdown(t, aircraftList = null) {
  const idx = makeIndex(aircraftList || aircraftRecords);
  const out = {};
  for (const [key, value] of Object.entries(t?.byTypeDuty || {})) {
    const split = key.lastIndexOf('|');
    if (split < 0) continue;
    const ref = key.slice(0, split);
    const duty = key.slice(split + 1);
    const a = idx.byId.get(String(ref)) || idx.byName.get(upper(ref));
    const kind = a?.kind || (SIMS.has(upper(ref)) ? 'sim' : null);
    if (kind !== 'sim') continue;
    out[duty] = addHours(out[duty] || 0, num(value));
  }
  return out;
}

// ยอดยกมาจาก "Total Last Page" ของ S1 แถว 23
const DUTY_BLOCKS = [
  ['CP/PI', 25, 8], ['PC', 33, 8], ['MP', 41, 8], ['IP', 49, 8], ['SP', 57, 8],
];
const SOLO_OPENING = [[65, 5], [66, 6]];

// names = ชื่อหัวคอลัมน์ L3:S3 จากไฟล์; canonical key = aircraftId เมื่อรู้จัก
export function parseOpening(row, names = AIRCRAFT, aircraftList = null) {
  const idx = makeIndex(aircraftList || aircraftRecords);
  const t = emptyTotals();
  const n = (i) => num(row[i]);
  const keyOf = (name) => idx.byName.get(upper(name))?.id || upper(name);
  t.hours = n(8); t.loggedHours = n(8);
  t.single = n(9); t.multi = n(10);
  names.forEach((a, i) => { if (a && i < 8 && n(11 + i)) t.byType[keyOf(a)] = n(11 + i); });
  t.xc = n(19); t.nightUn = n(20); t.nvg = n(21); t.ifr = n(22); t.imc = n(23);
  for (const [duty, start, count] of DUTY_BLOCKS) {
    for (let i = 0; i < count; i++) {
      const v = n(start + i);
      if (!v || !names[i]) continue;
      const k = keyOf(names[i]);
      t.byTypeDuty[`${k}|${duty}`] = v;
      const a = idx.byName.get(upper(names[i]));
      if (a) { t.byAircraftDuty[a.id] ||= {}; t.byAircraftDuty[a.id][duty] = v; }
    }
  }
  for (const [col, slot] of SOLO_OPENING) {
    const v = n(col);
    if (!v || !names[slot]) continue;
    const k = keyOf(names[slot]);
    t.byTypeDuty[`${k}|SOLO`] = v;
    const a = idx.byName.get(upper(names[slot]));
    if (a) { t.byAircraftDuty[a.id] ||= {}; t.byAircraftDuty[a.id].SOLO = v; }
  }
  t.sim = Object.entries(t.byType).reduce((s, [k, v]) => idx.byId.get(k)?.kind === 'sim' ? s + v : s, 0);
  // I23 เป็นชั่วโมงบินจริง; SIM นอก SP ยังอยู่ในคอลัมน์ L:S → เก็บยอดที่กรอกทั้งหมดแยกต่างหาก
  t.loggedHours = Math.max(t.hours, Object.values(t.byType).reduce((s, v) => addHours(s, v), 0));
  return t;
}

export const guessKind = (name) => (/^(SIM|FFS|FTD|FNPT)/i.test(name) ? 'sim' : 'single');

export function sheetSlotNames(ws) {
  return ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].map((c) => String(ws?.[`${c}3`]?.v ?? '').trim().toUpperCase());
}

export function sheetAircraft(ws) {
  const quoted = (f) => [...String(f || '').matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().toUpperCase());
  const single = new Set(quoted(ws?.J4?.f));
  const multi = new Set([...quoted(ws?.K4?.f), ...quoted(ws?.K5?.f)]);
  return sheetSlotNames(ws).filter(Boolean).map((name) => ({
    name,
    kind: multi.has(name) ? 'multi' : single.has(name) ? 'single' : guessKind(name),
  }));
}

export function sumFlights(list, aircraftList = null) {
  const t = emptyTotals();
  for (const f of list) addFlight(t, f, makeIndex(aircraftList || aircraftRecords));
  return t;
}

// P1-3: ord หาย → sort ตามวันที่ก่อน id (ไม่ใช่ UUID ล้วน ๆ)
export function sortFlights(list) {
  return [...list].sort((a, b) =>
    (Number(a?.ord) || 0) - (Number(b?.ord) || 0)
    || String(a?.date ?? '').localeCompare(String(b?.date ?? ''))
    || String(a?.id ?? '').localeCompare(String(b?.id ?? '')),
  );
}

export function slotOrd(sorted, date) {
  if (!sorted.length) return Date.now();
  let at = -1;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].date <= date) { at = i; break; }
  const last = sorted.length - 1;
  if (at === last) return Math.max(Date.now(), (sorted[last].ord ?? 0) + 1);
  if (at === -1) return (sorted[0].ord ?? 0) - 1;
  return ((sorted[at].ord ?? 0) + (sorted[at + 1].ord ?? 0)) / 2;
}

export const ORD_STEP = 1048576;

export function slotGapTooSmall(sorted, date) {
  let at = -1;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].date <= date) { at = i; break; }
  if (at < 0 || at === sorted.length - 1) return false;
  return (sorted[at + 1].ord ?? 0) - (sorted[at].ord ?? 0) < 1e-3;
}

export function renumber(sorted) {
  return sorted.map((f, i) => ({ ...f, ord: i * ORD_STEP }));
}

export function countOutOfOrder(sorted) {
  let n = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].date < sorted[i - 1].date) n++;
  return n;
}

export function reorderByDate(sorted) {
  const byDate = sorted
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.date < b.f.date ? -1 : a.f.date > b.f.date ? 1 : a.i - b.i))
    .map((x) => x.f);
  const changed = [];
  byDate.forEach((f, i) => { if (f.ord !== i * ORD_STEP) changed.push({ ...f, ord: i * ORD_STEP }); });
  return changed;
}

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

export function serialToISO(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

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
  let date = '';
  if (typeof dateRaw === 'number') date = dateRaw > 0 ? serialToISO(dateRaw) : '';
  else if (dateRaw instanceof Date) date = dateRaw.toISOString().slice(0, 10);
  else if (typeof dateRaw === 'string') date = parseDateText(dateRaw);
  if (!date) return null;
  const type = clean(row[2]).toUpperCase().slice(0, 12);
  if (!type) return null;
  const n = (v) => Math.max(0, num(v));
  const note = clean(row[67]) || clean(row[56]) || clean(row[54]);
  let mission = clean(row[6]);
  if (/^flight\s*trainni?ng$/i.test(mission)) mission = 'Flight Training';
  return {
    date, type,
    aircraftId: aircraftByName(type)?.id || null,
    number: clean(row[3]), dep: clean(row[4]), dest: clean(row[5]), mission,
    duty: clean(row[7]), hours,
    xc: n(row[19]), nightUn: n(row[20]), nvg: n(row[21]), ifr: n(row[22]), imc: n(row[23]), note,
  };
}

export function isUnreadableDataRow(row, rowIndex) {
  return rowIndex >= 3 && rowIndex <= 20 && (num(row[8]) > 0 || clean(row[2]) !== '' || row[1] != null) && !rowToFlight(row);
}

// ---------- ทำความสะอาดข้อมูลจาก backup/ภายนอก ----------
export function sanitizeFlight(f, aircraftList = null) {
  if (!f || typeof f !== 'object') return null;
  // กันเคส map(sanitizeFlight) ส่ง index เข้ามาเป็น aircraftList (ต้องเป็น array เท่านั้น)
  const idx = makeIndex(Array.isArray(aircraftList) ? aircraftList : aircraftRecords);
  const id = String(f.id ?? '').slice(0, 64);
  const date = String(f.date ?? '');
  const type = String(f.type ?? '').trim().toUpperCase().slice(0, 12);
  const hours = num(f.hours);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !type || !(hours > 0) || hours > 24) return null;
  const txt = (v, max) => String(v ?? '').trim().slice(0, max);
  const dutyRaw = txt(f.duty, 120);
  const dutyUpper = dutyRaw.toUpperCase();
  const duty = DUTIES.includes(dutyUpper) ? dutyUpper : dutyRaw;
  const matched = f.aircraftId ? idx.byId.get(String(f.aircraftId)) : idx.byName.get(type);
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
  if (issues.length) out._dataIssues = issues.filter((item, i, all) => all.findIndex((x) => x.code === item.code && x.field === item.field && x.value === item.value) === i);
  return out;
}

// P1-2: ทุก key ของยอดยกมาถูกแปลงเป็น aircraftId; ถ้า name-map กับ id-map ขัดกันให้ flag แทนเลือกข้างเงียบ ๆ
export function sanitizeOpening(o, aircraftList = null) {
  if (!o || typeof o !== 'object') return null;
  const idx = makeIndex(aircraftList || aircraftRecords);
  const t = emptyTotals();
  const invalid = Array.isArray(o._dataIssues) ? [...o._dataIssues] : [];
  const scalarKeys = ['hours', 'loggedHours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc'];
  for (const k of scalarKeys) {
    const value = Math.max(0, num(o[k]));
    if (!isValidHourIncrement(value, { allowZero: true })) invalid.push({ code: 'INVALID_HOUR_PRECISION', field: k, value: o[k] });
    else t[k] = value;
  }
  if (!Object.prototype.hasOwnProperty.call(o, 'loggedHours')) t.loggedHours = t.hours;

  const putIssue = (field, value) => invalid.push({ code: 'INVALID_HOUR_PRECISION', field, value });

  // byAircraftDuty คือแหล่งความจริงหลัก
  for (const [id, duties] of Object.entries(o.byAircraftDuty && typeof o.byAircraftDuty === 'object' ? o.byAircraftDuty : {})) {
    for (const [duty, raw] of Object.entries(duties || {})) {
      const value = num(raw);
      if (value <= 0) continue;
      if (!isValidHourIncrement(value)) { putIssue(`byAircraftDuty.${id}.${duty}`, raw); continue; }
      t.byAircraftDuty[id] ||= {};
      t.byAircraftDuty[id][duty] = value;
    }
  }

  for (const [rawKey, raw] of Object.entries(o.byType && typeof o.byType === 'object' ? o.byType : {})) {
    const value = num(raw);
    if (String(rawKey).length > 120 || value <= 0) continue;
    if (!isValidHourIncrement(value)) { putIssue(`byType.${rawKey}`, raw); continue; }
    const a = idx.byId.get(String(rawKey)) || idx.byName.get(upper(rawKey));
    t.byType[a?.id || upper(rawKey)] = value;
  }

  for (const [rawKey, raw] of Object.entries(o.byTypeDuty && typeof o.byTypeDuty === 'object' ? o.byTypeDuty : {})) {
    const split = rawKey.lastIndexOf('|');
    const ref = rawKey.slice(0, split);
    const duty = rawKey.slice(split + 1);
    const value = num(raw);
    if (String(rawKey).length > 120 || value <= 0) continue;
    if (!isValidHourIncrement(value)) { putIssue(`byTypeDuty.${rawKey}`, raw); continue; }
    const a = idx.byId.get(String(ref)) || idx.byName.get(upper(ref));
    const key = `${a?.id || upper(ref)}|${duty}`;
    const canonical = a ? t.byAircraftDuty[a.id]?.[duty] : undefined;
    if (canonical != null) {
      if (Math.abs(canonical - value) > 1e-8 && !invalid.some((x) => x.code === 'OPENING_CONFLICT' && x.field === rawKey)) {
        invalid.push({ code: 'OPENING_CONFLICT', field: rawKey, value, canonical });
      }
      t.byTypeDuty[key] = canonical;
    } else {
      t.byTypeDuty[key] = value;
      if (a) { t.byAircraftDuty[a.id] ||= {}; t.byAircraftDuty[a.id][duty] = value; }
    }
  }

  // P1-2: byAircraftDuty เป็นแหล่งความจริง → derive byType ให้ตรงกันเสมอ
  for (const [id, duties] of Object.entries(t.byAircraftDuty)) {
    const sum = Object.values(duties).reduce((s, v) => addHours(s, v), 0);
    if (sum > 0) t.byType[id] = t.byType[id] != null ? Math.max(t.byType[id], sum) : sum;
  }
  const simFromType = Object.entries(t.byType).reduce((s, [k, v]) => idx.byId.get(k)?.kind === 'sim' ? s + v : s, 0);
  if (simFromType > 0) t.sim = simFromType;
  else t.sim = Object.entries(t.byTypeDuty).reduce((s, [k, v]) => idx.byId.get(String(k).split('|')[0])?.kind === 'sim' ? s + v : s, 0);
  t.loggedHours = Math.max(t.loggedHours, Object.values(t.byType).reduce((s, v) => addHours(s, v), 0));

  if (invalid.length) t._dataIssues = invalid.filter((item, i, all) => all.findIndex((x) => x.code === item.code && x.field === item.field && JSON.stringify(x.value) === JSON.stringify(item.value)) === i);
  return t;
}
export const resolveOpening = (opening, aircraftList = null) => sanitizeOpening(opening, aircraftList);

// ---------- Migration v1 -> v2 (pure) ----------
export function prepareMigrationV2({ aircraft = DEFAULT_AIRCRAFT, flights = [], opening = null } = {}) {
  const config = normalizeAircraft(aircraft);
  const idx = makeIndex(config);
  const quarantine = [];
  const migratedFlights = flights.map((source, i) => {
    const f = sanitizeFlight(source, config);
    if (!f) {
      const rawId = String(source?.id ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
      quarantine.push({ id: rawId || `unreadable_${i + 1}`, issue: 'UNREADABLE_FLIGHT', source });
      return { source, migrated: null, issue: 'UNREADABLE_FLIGHT' };
    }
    const a = resolveAircraft(f, idx);
    if (a) {
      f.aircraftId = a.id;
      f._dataIssues = (f._dataIssues || []).filter((item) => item.code !== 'UNKNOWN_AIRCRAFT' && !(item.code === 'UNCONFIGURED_DUTY' && a.duties.includes(f.duty)));
      if (!a.duties.includes(f.duty) && !f._dataIssues.some((item) => item.code === 'UNCONFIGURED_DUTY')) f._dataIssues.push({ code: 'UNCONFIGURED_DUTY', field: 'duty', value: f.duty });
    } else if (!f._dataIssues?.some((item) => item.code === 'UNKNOWN_AIRCRAFT')) {
      f._dataIssues = [...(f._dataIssues || []), { code: 'UNKNOWN_AIRCRAFT', field: 'type', value: f.type }];
    }
    return { source, migrated: f, issue: null };
  });

  const valid = migratedFlights.filter((x) => x.migrated).map((x) => x.migrated);
  const anchored = valid.filter((f) => Number(f.ord) > 0);
  const missingOrd = valid.filter((f) => !(Number(f.ord) > 0));
  const withoutOrd = missingOrd.length;
  if (withoutOrd) {
    const byDate = missingOrd
      .map((f, i) => ({ f, i }))
      .sort((a, b) => String(a.f.date).localeCompare(String(b.f.date)) || a.i - b.i);
    if (!anchored.length) {
      // ไม่มีลำดับเดิมเลย → ใช้วันที่เป็นแกน (ไม่ใช่ UUID)
      byDate.forEach((e, i) => { e.f.ord = i * ORD_STEP; });
    } else {
      // มีลำดับอยู่แล้ว → เติมเฉพาะรายการที่หาย ต่อท้ายโดยไม่ขยับของเดิม
      let next = Math.max(...anchored.map((f) => Number(f.ord))) + ORD_STEP;
      byDate.forEach((e) => { e.f.ord = next; next += ORD_STEP; });
    }
  }

  const oldOpening = opening ? sanitizeOpening(opening, config) : null;
  const byAircraftDuty = Object.fromEntries(Object.entries(oldOpening?.byAircraftDuty || {}).map(([id, duties]) => [id, { ...(duties || {}) }]));
  const unresolvedOpening = {};
  for (const [key, value] of Object.entries(oldOpening?.byTypeDuty || {})) {
    const split = key.lastIndexOf('|');
    const ref = key.slice(0, split);
    const duty = key.slice(split + 1);
    const a = idx.byId.get(String(ref)) || idx.byName.get(upper(ref));
    if (a) {
      byAircraftDuty[a.id] ||= {};
      if (byAircraftDuty[a.id][duty] == null) byAircraftDuty[a.id][duty] = value;
    } else unresolvedOpening[key] = value;
  }
  const migratedOpening = oldOpening ? {
    ...oldOpening,
    version: 2,
    byTypeDuty: Object.fromEntries(Object.entries(oldOpening.byTypeDuty || {}).filter(([k]) => !(k in unresolvedOpening))),
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
    ordBackfilled: withoutOrd,
  };
  return {
    version: 2,
    config: { version: 2, v: 2, aircraft: config },
    flights: migratedFlights,
    quarantine,
    opening: migratedOpening,
    dataQuality,
    requiresReview: Object.values(dataQuality).some((n) => n > 0),
  };
}

export const flightKey = (f) => [f.date, f.type, f.number, f.dep, f.dest, f.duty, num(f.hours)].join('|');

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
