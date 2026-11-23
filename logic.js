// logic.js — ตรรกะล้วน ไม่แตะ DOM / Firebase (ทดสอบด้วย Node ได้)

export const DUTIES = ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'];
// รายการภารกิจ (สะกด Flight Training ให้ถูกต้อง; ข้อมูลเก่าที่สะกด Trainning ยังนำเข้าได้)
export const MISSIONS = ['Ferry Flight', 'Parachute', 'Air Transportation', 'Air Medivac', 'Flight Training', 'Special Operation', 'Standardization', 'Other', 'VVIP', 'VIP'];

// ---------- รายการแบบอากาศยาน (ผู้ใช้กำหนดเองได้ สูงสุด 8 แบบ = จำนวนช่องในแม่แบบ Excel) ----------
// kind: single = เครื่องยนต์เดียว, multi = หลายเครื่องยนต์, sim = เครื่องฝึกบินจำลอง
export const MAX_AIRCRAFT = 8;
export const KIND_LABEL = { single: 'เครื่องยนต์เดียว', multi: 'หลายเครื่องยนต์', sim: 'เครื่องฝึกจำลอง (SIM)' };
export const KIND_SHORT = { single: 'เครื่องยนต์เดียว', multi: 'หลายเครื่องยนต์', sim: 'เครื่องฝึกจำลอง' };
export const DEFAULT_AIRCRAFT = [
  { name: 'AW139', kind: 'multi' },
  { name: 'AW149', kind: 'multi' },
  { name: 'AS550', kind: 'single' },
  { name: 'BELL212', kind: 'multi' },
  { name: 'UH1', kind: 'single' },
  { name: 'H269', kind: 'single' },
  { name: 'EN48', kind: 'single' },
  { name: 'SIM', kind: 'sim' },
];
// อ็อบเจกต์ชุดนี้ถูกแก้ในที่เดิม (ผู้ที่ import ไปเห็นค่าล่าสุดเสมอ)
export const AIRCRAFT = [];
export const SINGLE = new Set();
export const MULTI = new Set();
export const SIMS = new Set();

export function setAircraft(list) {
  AIRCRAFT.length = 0; SINGLE.clear(); MULTI.clear(); SIMS.clear();
  for (const a of list) {
    AIRCRAFT.push(a.name);
    (a.kind === 'multi' ? MULTI : a.kind === 'sim' ? SIMS : SINGLE).add(a.name);
  }
}
export const kindOf = (name) => (MULTI.has(name) ? 'multi' : SIMS.has(name) ? 'sim' : 'single');
export const getAircraft = () => AIRCRAFT.map((name) => ({ name, kind: kindOf(name) }));
export const sameAircraft = (a, b) => a.length === b.length && a.every((x, i) => x.name === b[i].name && x.kind === b[i].kind);
export const isDefaultAircraft = (list) => sameAircraft(list, DEFAULT_AIRCRAFT);
setAircraft(DEFAULT_AIRCRAFT);

export const NAME_RE = /^[A-Z0-9][A-Z0-9 ._\/-]{0,11}$/;
export function validateAircraft(list) {
  if (!list.length) return 'ต้องมีแบบอากาศยานอย่างน้อย 1 แบบ';
  if (list.length > MAX_AIRCRAFT) return `ใส่ได้สูงสุด ${MAX_AIRCRAFT} แบบ (ตามจำนวนช่องในไฟล์ Excel)`;
  const seen = new Set();
  for (const a of list) {
    if (!a.name) return 'มีแถวที่ยังไม่ได้ใส่ชื่อ';
    if (!NAME_RE.test(a.name)) return `ชื่อ “${a.name}” ใช้ไม่ได้ — ใช้ตัวอักษร A–Z ตัวเลข และ - . / เว้นวรรค ได้ไม่เกิน 12 ตัว`;
    if (seen.has(a.name)) return `ชื่อ “${a.name}” ซ้ำกัน`;
    seen.add(a.name);
    if (!['single', 'multi', 'sim'].includes(a.kind)) return `เลือกชนิดเครื่องยนต์ของ ${a.name}`;
  }
  return '';
}

// ในไฟล์ Excel: ช่อง (ลำดับ) ที่ i มีคอลัมน์ "แบบ × หน้าที่" ให้หน้าที่ใดบ้าง
// ช่อง 0–4 (AW139..UH1): CP/PI PC MP IP SP
// ช่อง 5 (H269): CP/PI PC SOLO
// ช่อง 6 (EN48): CP/PI PC MP IP SP SOLO
// ช่อง 7 (SIM): CP/PI PC IP SP
export function slotDuties(i) {
  if (i < 5) return ['CP/PI', 'PC', 'MP', 'IP', 'SP'];
  if (i === 5) return ['CP/PI', 'PC', 'SOLO'];
  if (i === 6) return ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'];
  if (i === 7) return ['CP/PI', 'PC', 'IP', 'SP'];
  return ['CP/PI'];
}

// SOLO ในไฟล์ Excel อยู่คอลัมน์ BC/BD = ช่องลำดับ 5 และ 6 (ชื่อตามรายการผู้ใช้หลัง rename)
export function soloAircraftNames() {
  return new Set([AIRCRAFT[5], AIRCRAFT[6]].filter(Boolean).map((n) => String(n).toUpperCase()));
}
export function isSoloAllowed(type) {
  return soloAircraftNames().has(String(type || '').trim().toUpperCase());
}

// เที่ยวบินที่หน้าที่ไม่มีคอลัมน์รองรับใน Excel (ยังนับในชั่วโมงรวมตามปกติ)
export function coverageGaps(flights, opening = null) {
  let n = 0;
  const supported = (type, duty) => {
    const i = AIRCRAFT.indexOf(type);
    return i >= 0 && slotDuties(i).includes(duty);
  };
  for (const f of flights) if (!supported(f.type, f.duty)) n++;
  for (const [key, value] of Object.entries(opening?.byTypeDuty || {})) {
    if (num(value) <= 0) continue;
    const split = key.lastIndexOf('|');
    const type = key.slice(0, split);
    const duty = key.slice(split + 1);
    if (!supported(type, duty)) n++;
  }
  return n;
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
  // แสดง Decimal Hours โดยตรง (ไม่แปลงเป็นชั่วโมง:นาที) และซ่อน floating-point noise
  const r = Number(num(x).toPrecision(15));
  const s = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 15 }).format(r);
  return s.includes('.') ? s : `${s}.0`;
}

export function emptyTotals() {
  return { hours: 0, single: 0, multi: 0, sim: 0, xc: 0, nightUn: 0, nvg: 0, ifr: 0, imc: 0, byType: {}, byTypeDuty: {} };
}

export function addFlight(t, f) {
  const h = num(f.hours);
  t.hours += h;
  if (SINGLE.has(f.type)) t.single += h;
  if (MULTI.has(f.type)) t.multi += h;
  if (SIMS.has(f.type)) t.sim += h;
  for (const c of CONDS) t[c.key] += num(f[c.key]);
  t.byType[f.type] = (t.byType[f.type] || 0) + h;
  const k = `${f.type}|${f.duty}`;
  t.byTypeDuty[k] = (t.byTypeDuty[k] || 0) + h;
  return t;
}

export function addTotals(a, b) {
  const t = emptyTotals();
  for (const k of ['hours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc']) t[k] = num(a?.[k]) + num(b?.[k]);
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src?.byType || {})) t.byType[k] = (t.byType[k] || 0) + num(v);
    for (const [k, v] of Object.entries(src?.byTypeDuty || {})) t.byTypeDuty[k] = (t.byTypeDuty[k] || 0) + num(v);
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
      if (v && names[i]) t.byTypeDuty[`${names[i]}|${duty}`] = v;
    }
  }
  for (const [col, slot] of SOLO_OPENING) {
    const v = n(col);
    if (v && names[slot]) t.byTypeDuty[`${names[slot]}|SOLO`] = v;
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
  // เก็บชั่วโมงเป็น Decimal Hours ตามค่าต้นฉบับ ไม่ปัดเป็นนาทีหรือจำกัด 2 ตำแหน่ง
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
    number: clean(row[3]),
    dep: clean(row[4]),
    dest: clean(row[5]),
    mission,
    duty: clean(row[7]).toUpperCase(),
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
  let duty = txt(f.duty, 12).toUpperCase();
  const dutyIn = duty;
  if (!DUTIES.includes(duty)) duty = 'CP/PI'; // หน้าที่นอกรายการ → ค่าเริ่มต้น
  // SOLO ใช้ได้เฉพาะแบบที่อยู่ในช่อง 5–6 ของรายการผู้ใช้ (คอลัมน์ BC/BD ใน Excel)
  if (duty === 'SOLO' && !isSoloAllowed(type)) duty = 'CP/PI';
  let mission = txt(f.mission, 120);
  if (/^flight\s*trainni?ng$/i.test(mission)) mission = 'Flight Training';
  const out = {
    id, date, type, hours,
    number: txt(f.number, 20), dep: txt(f.dep, 120), dest: txt(f.dest, 120),
    mission, duty, note: txt(f.note, 500),
    ord: Number.isFinite(Number(f.ord)) ? Number(f.ord) : 0,
  };
  // สภาพการบินไม่เกินชั่วโมงบินของเที่ยว
  for (const c of CONDS) {
    const v = Math.max(0, num(f[c.key]));
    out[c.key] = Math.min(v, hours);
  }
  if (dutyIn && dutyIn !== duty) out._dutyFixed = dutyIn; // บอก import ว่ามีการแก้ duty
  return out;
}

export function sanitizeOpening(o) {
  if (!o || typeof o !== 'object') return null;
  const t = emptyTotals();
  for (const k of ['hours', 'single', 'multi', 'sim', 'xc', 'nightUn', 'nvg', 'ifr', 'imc']) t[k] = Math.max(0, num(o[k]));
  for (const key of ['byType', 'byTypeDuty']) {
    for (const [k, v] of Object.entries(o[key] && typeof o[key] === 'object' ? o[key] : {})) {
      if (String(k).length <= 40 && num(v) > 0) t[key][k] = num(v);
    }
  }
  return t;
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
