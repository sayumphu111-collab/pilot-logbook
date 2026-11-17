// logic.js — ตรรกะล้วน ไม่แตะ DOM / Firebase (ทดสอบด้วย Node ได้)

export const AIRCRAFT = ['AW139', 'AW149', 'AS550', 'BELL212', 'UH1', 'H269', 'EN48', 'SIM'];
export const DUTIES = ['CP/PI', 'PC', 'MP', 'IP', 'SP', 'SOLO'];
export const MISSIONS = ['Ferry Flight', 'Training', 'Check Ride', 'Transport', 'VIP', 'SAR', 'Other'];
export const MULTI = new Set(['AW139', 'AW149', 'BELL212']);
export const SINGLE = new Set(['AS550', 'UH1', 'H269', 'EN48']);
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
  const r = Math.round(num(x) * 100) / 100;
  return Math.abs(r * 10 - Math.round(r * 10)) < 1e-9 ? r.toFixed(1) : r.toFixed(2);
}

export function emptyTotals() {
  return { hours: 0, single: 0, multi: 0, sim: 0, xc: 0, nightUn: 0, nvg: 0, ifr: 0, imc: 0, byType: {}, byTypeDuty: {} };
}

export function addFlight(t, f) {
  const h = num(f.hours);
  t.hours += h;
  if (SINGLE.has(f.type)) t.single += h;
  if (MULTI.has(f.type)) t.multi += h;
  if (f.type === 'SIM') t.sim += h;
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
// แถวนี้ในไฟล์: I=ชม.รวม J=Single K=Multi L..S=แบบอากาศยาน T..X=สภาพการบิน Z..BB=แบบ x หน้าที่
const DUTY_BLOCKS = [
  ['CP/PI', 25, AIRCRAFT.length],
  ['PC', 33, 6],
  ['MP', 39, 5],
  ['IP', 44, 5],
  ['SP', 49, 5],
];
export function parseOpening(row) {
  const t = emptyTotals();
  const n = (i) => num(row[i]);
  t.hours = n(8); t.single = n(9); t.multi = n(10);
  AIRCRAFT.forEach((a, i) => { if (n(11 + i)) t.byType[a] = n(11 + i); });
  t.xc = n(19); t.nightUn = n(20); t.nvg = n(21); t.ifr = n(22); t.imc = n(23);
  t.sim = t.byType.SIM || 0;
  for (const [duty, start, count] of DUTY_BLOCKS) {
    for (let i = 0; i < count; i++) {
      const v = n(start + i);
      if (v) t.byTypeDuty[`${AIRCRAFT[i]}|${duty}`] = v;
    }
  }
  return t;
}

export function sumFlights(list) {
  const t = emptyTotals();
  for (const f of list) addFlight(t, f);
  return t;
}

export function sortFlights(list) {
  return [...list].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ord ?? 0) - (b.ord ?? 0) || (a.id < b.id ? -1 : 1));
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

export function rowToFlight(row) {
  const dateRaw = row[1];
  const hours = row[8];
  if (typeof hours !== 'number' || !(hours > 0)) return null;
  let date = '';
  if (typeof dateRaw === 'number') date = serialToISO(dateRaw);
  else if (dateRaw instanceof Date) date = dateRaw.toISOString().slice(0, 10);
  else return null;
  const type = clean(row[2]).toUpperCase();
  if (!type) return null;
  const n = (v) => (typeof v === 'number' ? v : 0);
  return {
    date,
    type,
    number: clean(row[3]),
    dep: clean(row[4]),
    dest: clean(row[5]),
    mission: clean(row[6]),
    duty: clean(row[7]).toUpperCase(),
    hours,
    xc: n(row[19]),
    nightUn: n(row[20]),
    nvg: n(row[21]),
    ifr: n(row[22]),
    imc: n(row[23]),
    note: clean(row[54]),
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

// ---------- ส่งออก Excel (array-of-arrays ต่อชีต) ----------
const EXPORT_HEAD = [
  'No.', 'Date', 'Type', 'Number', 'Departure', 'Destination', 'Mission/Duty', 'Duty', 'Hours',
  'Single', 'Multi', ...AIRCRAFT, 'X-Country', 'Night Un-Aided', 'NVG', 'IFR Training', 'IMC', 'หมายเหตุ',
];

function totalsToCells(t) {
  return [
    t.hours, t.single, t.multi,
    ...AIRCRAFT.map((a) => t.byType[a] || 0),
    t.xc, t.nightUn, t.nvg, t.ifr, t.imc,
  ].map((x) => (x ? Math.round(x * 100) / 100 : 0));
}

export function exportPageAOA(page) {
  const aoa = [EXPORT_HEAD];
  for (let i = 0; i < PAGE_SIZE; i++) {
    const f = page.rows[i];
    if (!f) { aoa.push([]); continue; }
    const single = SINGLE.has(f.type) ? f.hours : '';
    const multi = MULTI.has(f.type) ? f.hours : '';
    aoa.push([
      f.no, dmy(f.date), f.type, f.number, f.dep, f.dest, f.mission, f.duty, f.hours,
      single, multi,
      ...AIRCRAFT.map((a) => (f.type === a ? f.hours : '')),
      f.xc || '', f.nightUn || '', f.nvg || '', f.ifr || '', f.imc || '', f.note || '',
    ]);
  }
  const pad = ['', '', '', '', '', ''];
  aoa.push([...pad, 'Total This Page', '', ...totalsToCells(page.thisPage)]);
  aoa.push([...pad, 'Total Last Page', '', ...totalsToCells(page.last)]);
  aoa.push([...pad, 'Total Forward', '', ...totalsToCells(page.forward)]);
  return aoa;
}

export function exportSummaryAOA(sorted, opening = null) {
  const t = addTotals(opening, sumFlights(sorted));
  const r2 = (x) => (x ? Math.round(x * 100) / 100 : '');
  const types = [...new Set([...AIRCRAFT, ...Object.keys(t.byType)])].filter((x) => t.byType[x]);
  const aoa = [['ARMY PILOT LOGBOOK — Summary'], [], ['TYPE', ...DUTIES, 'TOTAL']];
  for (const ty of types) {
    aoa.push([ty, ...DUTIES.map((d) => r2(t.byTypeDuty[`${ty}|${d}`])), r2(t.byType[ty])]);
  }
  aoa.push(['TOTAL', ...DUTIES.map(() => ''), r2(t.hours)]);
  aoa.push([]);
  aoa.push(['Single engine', r2(t.single)]);
  aoa.push(['Multi engine', r2(t.multi)]);
  aoa.push(['Simulator', r2(t.sim)]);
  aoa.push(['X-Country', r2(t.xc)]);
  aoa.push(['Night Un-Aided', r2(t.nightUn)]);
  aoa.push(['Night NVG', r2(t.nvg)]);
  aoa.push(['IFR Training', r2(t.ifr)]);
  aoa.push(['IMC', r2(t.imc)]);
  return aoa;
}
