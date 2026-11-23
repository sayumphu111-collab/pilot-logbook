// xlsxfill.js — กรอกข้อมูลลงไฟล์แม่แบบ (template.xlsx = ไฟล์ต้นฉบับที่ล้างข้อมูลแล้ว)
// แก้เฉพาะค่าในช่องข้อมูล สูตร/สี/เส้น/dropdown ของต้นฉบับอยู่ครบ ไม่ใช้ DOM จึงทดสอบด้วย Node ได้
import { AIRCRAFT, CONDS, PAGE_SIZE, addTotals, isDefaultAircraft, num, slotDuties } from './logic.js';

export const MAX_PAGES = 50;
const FIRST_ROW = 4;

// ---------- ตัวช่วยคอลัมน์ ----------
export function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}
export function colLetters(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const CELL_MAX = 30000; // Excel รับข้อความในเซลล์ได้ไม่เกิน 32,767 ตัวอักษร
const xmlEsc = (s) => String(s).slice(0, CELL_MAX).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function isoToSerial(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

// ---------- สร้าง XML ของเซลล์ ----------
const excelNumber = (v) => Number.isFinite(Number(v)) ? String(Number(Number(v).toPrecision(15))) : '0';
const numXml = (ref, s, v) => `<c r="${ref}"${s}><v>${excelNumber(v)}</v></c>`;
const strXml = (ref, s, v) => `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
const cellXml = (ref, s, v) => (typeof v === 'number' ? numXml(ref, s, v) : strXml(ref, s, v));

// ---------- ใส่ค่าเข้าชีต ----------
// values: { 'B4': 45486, 'C4': 'AW139', ... }
export function fillSheetXml(xml, values) {
  const byRow = new Map();
  for (const [ref, v] of Object.entries(values)) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    const row = Number(m[2]);
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ ref, col: colNum(m[1]), v });
  }
  for (const [row, cells] of byRow) {
    const rowRe = new RegExp(`<row r="${row}"(?:\\s[^>]*)?>([\\s\\S]*?)</row>`);
    const rm = rowRe.exec(xml);
    if (!rm) throw new Error(`ไม่พบแถว ${row} ในแม่แบบ`);
    let inner = rm[1];
    for (const { ref, col, v } of cells) {
      const cellRe = new RegExp(`<c r="${ref}"((?:\\s+[A-Za-z:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);
      const cm = cellRe.exec(inner);
      if (cm) {
        if (cm[2] && cm[2].includes('<f')) continue; // ไม่เขียนทับสูตร
        const st = /s="(\d+)"/.exec(cm[1]);
        const nx = cellXml(ref, st ? ` s="${st[1]}"` : '', v);
        inner = inner.replace(cm[0], () => nx);
      } else {
        // ไม่มีเซลล์นี้ในแถว → แทรกตามลำดับคอลัมน์
        const re = /<c r="([A-Z]+)\d+"/g;
        let at = inner.length, x;
        while ((x = re.exec(inner))) { if (colNum(x[1]) > col) { at = x.index; break; } }
        inner = inner.slice(0, at) + cellXml(ref, '', v) + inner.slice(at);
      }
    }
    const open = rm[0].slice(0, rm[0].indexOf('>') + 1);
    xml = xml.replace(rm[0], () => `${open}${inner}</row>`);
  }
  return xml;
}

// ---------- ค่าของแต่ละหน้า (ช่องที่ผู้ใช้กรอกในต้นฉบับ) ----------
// B=วันที่ C=แบบ D=หมายเลข E=ต้นทาง F=ปลายทาง G=ภารกิจ H=หน้าที่ I=ชั่วโมง
// T=X-Country U=Night Un-aided V=NVG W=IFR Training X=IMC
// BN–BO=SOLO (สูตรคำนวณเอง) BP=หมายเหตุ
const COND_COL = { xc: 'T', nightUn: 'U', nvg: 'V', ifr: 'W', imc: 'X' };

export function pageValues(page) {
  const v = {};
  page.rows.forEach((f, i) => {
    const r = FIRST_ROW + i;
    v[`B${r}`] = isoToSerial(f.date);
    v[`C${r}`] = f.type;
    if (f.number !== '' && f.number != null) v[`D${r}`] = /^\d+$/.test(String(f.number)) ? Number(f.number) : String(f.number);
    if (f.dep) v[`E${r}`] = f.dep;
    if (f.dest) v[`F${r}`] = f.dest;
    if (f.mission) v[`G${r}`] = f.mission;
    if (f.duty) v[`H${r}`] = f.duty;
    v[`I${r}`] = num(f.hours);
    for (const c of CONDS) if (num(f[c.key]) > 0) v[`${COND_COL[c.key]}${r}`] = num(f[c.key]);
    if (f.note) v[`BP${r}`] = f.note;
  });
  return v;
}

// ---------- ยอดยกมา (S1 แถว 23) ----------
const DUTY_BLOCKS = [
  ['CP/PI', 'Z', 8],
  ['PC', 'AH', 8],
  ['MP', 'AP', 8],
  ['IP', 'AX', 8],
  ['SP', 'BF', 8],
];
// SOLO: BN=ช่อง5, BO=ช่อง6
const SOLO_COLS = { 5: 'BN', 6: 'BO' };
export function openingValues(o) {
  const t = o || {};
  const v = {};
  const put = (col, x) => { v[`${col}23`] = num(x); };
  put('I', t.hours); put('J', t.single); put('K', t.multi);
  for (let i = 0; i < 8; i++) put(colLetters(colNum('L') + i), AIRCRAFT[i] ? t.byType?.[AIRCRAFT[i]] : 0);
  put('T', t.xc); put('U', t.nightUn); put('V', t.nvg); put('W', t.ifr); put('X', t.imc);
  for (const [duty, start, count] of DUTY_BLOCKS) {
    for (let i = 0; i < count; i++) put(colLetters(colNum(start) + i), AIRCRAFT[i] ? t.byTypeDuty?.[`${AIRCRAFT[i]}|${duty}`] : 0);
  }
  for (const [slot, col] of Object.entries(SOLO_COLS)) {
    const i = Number(slot);
    put(col, AIRCRAFT[i] ? t.byTypeDuty?.[`${AIRCRAFT[i]}|SOLO`] : 0);
  }
  return v;
}


// ---------- ปรับแม่แบบให้ตรงกับรายการแบบอากาศยานของผู้ใช้ ----------
// แม่แบบมี 8 ช่องแบบอากาศยาน (ชื่อฝังอยู่ในสูตรและหัวคอลัมน์) → เปลี่ยนชื่อ/ชนิดเครื่องยนต์ตามที่ผู้ใช้ตั้ง
const TPL_NAMES = ['AW139', 'AW149', 'AS550', 'BELL212', 'UH1', 'H269', 'EN48', 'SIM']; // ชื่อในสูตร
const TPL_HEADERS = ['AW139', 'AW149', 'AS550', 'Bell212', 'UH1', 'H269', 'EN48', 'SIM']; // ชื่อในหัวคอลัมน์
const UNUSED = '?'; // ช่องที่ไม่ได้ใช้: ชื่อที่ไม่มีทางตรงกับเที่ยวบินใด
const q = (x) => `&quot;${x}&quot;`;
const F_OPEN = '<f(?:\\s[^>]*[^/>])?>'; // แท็ก <f> ที่มีเนื้อหา (ไม่ใช่ <f .../> ของสูตรร่วม)

// เปลี่ยนชื่อในสูตรทุกที่พร้อมกัน (ผ่านโทเค็น กันกรณีสลับชื่อกันระหว่างช่อง)
export function renameFormulaNames(xml, slotNames) {
  return xml.replace(new RegExp(`(${F_OPEN})([\\s\\S]*?)(</f>)`, 'g'), (m, a, body, z) => {
    let b = body;
    TPL_NAMES.forEach((old, i) => { b = b.split(q(old)).join(`&quot;\uE000${i}\uE000&quot;`); });
    slotNames.forEach((nw, i) => { b = b.split(`\uE000${i}\uE000`).join(xmlEsc(nw)); });
    return a + b + z;
  });
}

export function setFormulaText(xml, ref, text) {
  const re = new RegExp(`(<c r="${ref}"(?:\\s+[A-Za-z:]+="[^"]*")*>\\s*${F_OPEN})([\\s\\S]*?)(</f>)`);
  return xml.replace(re, (m, a, b, z) => a + text + z);
}

const engineFormula = (names, r) =>
  (names.length ? `IF(OR(${names.map((n) => `C${r}=${q(xmlEsc(n))}`).join(',')}), I${r},${q('-')})` : `IF(FALSE, I${r},${q('-')})`);

// ชั่วโมงบินเป็นตัวเลข Decimal Hours ไม่ใช่รายการ dropdown แบบเพิ่มทีละ 0.1
export function retargetHoursValidation(xml) {
  return xml.replace(/<dataValidation\b([^>]*\bsqref="I4:I21"[^>]*)><formula1>[\s\S]*?<\/formula1>(?:<formula2>[\s\S]*?<\/formula2>)?<\/dataValidation>/, (m, rawAttrs) => {
    let attrs = rawAttrs.replace(/\s+type="[^"]*"/, '').replace(/\s+operator="[^"]*"/, '');
    attrs += ' type="decimal" operator="between"';
    return `<dataValidation${attrs}><formula1>0</formula1><formula2>24</formula2></dataValidation>`;
  });
}

// รายการ dropdown ของช่อง "Type" (C)
export function retargetTypeValidation(xml, names) {
  return xml.replace(
    /(<dataValidation [^>]*sqref="C\d+:C\d+"[^>]*><formula1>)[\s\S]*?(<\/formula1>)/g,
    (m, a, z) => `${a}${q(names.map(xmlEsc).join(','))}${z}`,
  );
}

export function renameSharedStrings(sst, slotNames) {
  return sst.split(/(<si>[\s\S]*?<\/si>)/).map((p) => {
    if (!p.startsWith('<si>')) return p;
    const i = TPL_HEADERS.indexOf(p.replace(/<[^>]+>/g, ''));
    if (i < 0) return p;
    return slotNames[i] === UNUSED ? '<si><t/></si>' : `<si><t>${xmlEsc(slotNames[i])}</t></si>`;
  }).join('');
}

// ชีต Summary: เขียนแถวแบบอากาศยาน (แถว 5–12) ใหม่ตามรายการของผู้ใช้
// SOLO อยู่ในคอลัมน์ C ของ Summary และอ้าง BC/BD ของ S50 เท่านั้น (ช่อง 5 และ 6)
const DUTY_FIRST_COL = { 'CP/PI': 'Z', PC: 'AH', MP: 'AP', IP: 'AX', SP: 'BF' };
const DUTY_SUMMARY_COL = { SOLO: 'C', 'CP/PI': 'D', PC: 'E', MP: 'F', IP: 'G', SP: 'H' };
const SOLO_SHEET_COL = { 5: 'BN', 6: 'BO' };

function dutySheetRef(duty, slotIndex) {
  if (duty === 'SOLO') {
    const col = SOLO_SHEET_COL[slotIndex];
    return col ? `'S50'!${col}24` : null;
  }
  const base = DUTY_FIRST_COL[duty];
  if (!base) return null;
  return `'S50'!${colLetters(colNum(base) + slotIndex)}24`;
}

function setSummaryCell(xml, ref, spec) {
  const re = new RegExp(`<c r="${ref}"((?:\\s+[A-Za-z:]+="[^"]*")*)\\s*(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(xml);
  if (!m) return xml;
  const st = /s="(\d+)"/.exec(m[1]);
  const s = st ? ` s="${st[1]}"` : '';
  let out;
  if (!spec) out = `<c r="${ref}"${s}/>`;
  else if (spec.text !== undefined) out = `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(spec.text)}</t></is></c>`;
  else out = `<c r="${ref}"${s}><f>${spec.f}</f></c>`;
  return xml.replace(m[0], () => out);
}

export function rebuildSummary(xml, aircraft) {
  for (let k = 0; k < 8; k++) {
    const r = 5 + k;
    const a = aircraft[k];
    const cells = {};
    if (a) {
      cells.B = { text: a.name };
      const refs = slotDuties(k).map((d) => ({ d, ref: dutySheetRef(d, k) })).filter((x) => x.ref);
      if (a.kind === 'sim') cells.M = { f: refs.map((x) => x.ref).join('+') };
      else for (const x of refs) {
        const col = DUTY_SUMMARY_COL[x.d];
        if (col) cells[col] = { f: x.ref };
      }
      if (a.kind === 'single') cells.N = { f: `SUM(C${r}:H${r})` };
      if (a.kind === 'multi') cells.O = { f: `SUM(C${r}:H${r})` };
    }
    for (const col of 'BCDEFGHIJKLMNO') xml = setSummaryCell(xml, `${col}${r}`, cells[col] || null);
  }
  return xml;
}

// ช่อง (แบบ|หน้าที่) ที่ชีต Summary ต้นฉบับอ้างถึง — นอกจากนี้ต้นฉบับไม่รวมไว้
const ORIGINAL_SUMMARY_COVERED = new Set([
  'AW139|CP/PI', 'AW139|PC', 'AW139|MP', 'AW139|IP', 'AW139|SP',
  'AW149|CP/PI', 'AW149|PC', 'AW149|MP', 'AW149|IP', 'AW149|SP',
  'AS550|CP/PI', 'AS550|PC', 'AS550|MP', 'AS550|IP', 'AS550|SP',
  'BELL212|CP/PI', 'BELL212|PC', 'BELL212|MP', 'BELL212|IP', 'BELL212|SP',
  'UH1|CP/PI', 'UH1|PC', 'UH1|MP', 'UH1|IP', 'UH1|SP',
  'H269|CP/PI', 'H269|PC', 'H269|SOLO',
  'EN48|CP/PI', 'EN48|SOLO',
  'SIM|CP/PI',
]);

// เปลี่ยนหัวคอลัมน์ที่แม่แบบเก็บเป็น inlineStr (ไม่ใช่ sharedStrings)
function setInlineHeader(xml, ref, value) {
  const re = new RegExp(`<c r="${ref}"((?:\\s+[A-Za-z:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`);
  const m = re.exec(xml);
  if (!m) return xml;
  const style = /\bs="(\d+)"/.exec(m[1]);
  const attrs = style ? ` s="${style[1]}"` : '';
  const cell = value
    ? `<c r="${ref}"${attrs} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`
    : `<c r="${ref}"${attrs} t="inlineStr"><is><t></t></is></c>`;
  return xml.replace(m[0], () => cell);
}

const HEADER_GROUPS = [
  ['L', 8, 0],       // Aircraft type totals
  ['Z', 8, 0],       // CP/PI
  ['AH', 8, 0],      // PC
  ['AP', 8, 0],      // MP
  ['AX', 8, 0],      // IP
  ['BF', 8, 0],      // SP
];
function retargetInlineHeaders(xml, aircraft) {
  for (const [start, count, offset] of HEADER_GROUPS) {
    for (let i = 0; i < count; i++) {
      const name = aircraft[i + offset]?.name || '';
      xml = setInlineHeader(xml, `${colLetters(colNum(start) + i)}3`, name);
    }
  }
  // SOLO รองรับเฉพาะช่องแบบอากาศยานลำดับ 5 และ 6 ในโครงสร้าง Excel นี้
  xml = setInlineHeader(xml, 'BN3', aircraft[5]?.name || '');
  xml = setInlineHeader(xml, 'BO3', aircraft[6]?.name || '');
  return xml;
}

export async function customizeTemplate({ getText, setText }, aircraft) {
  const paths = sheetPaths(await getText('xl/workbook.xml'), await getText('xl/_rels/workbook.xml.rels'));
  const slotNames = Array.from({ length: 8 }, (_, i) => aircraft[i]?.name ?? UNUSED);
  const names = aircraft.map((a) => a.name);
  const singles = aircraft.filter((a) => a.kind === 'single').map((a) => a.name);
  const multis = aircraft.filter((a) => a.kind === 'multi').map((a) => a.name);

  for (let n = 1; n <= MAX_PAGES; n++) {
    const path = paths[`S${n}`];
    if (!path) continue;
    let x = renameFormulaNames(await getText(path), slotNames);
    x = setFormulaText(x, 'J4', engineFormula(singles, 4));
    x = setFormulaText(x, 'K4', engineFormula(multis, 4));
    x = setFormulaText(x, 'K5', engineFormula(multis, 5));
    x = retargetTypeValidation(x, names);
    x = retargetInlineHeaders(x, aircraft);
    setText(path, x);
  }
  // แม่แบบรุ่นนี้ใช้ inline strings และไม่มี sharedStrings.xml; รองรับทั้งสองแบบ
  try {
    const shared = await getText('xl/sharedStrings.xml');
    setText('xl/sharedStrings.xml', renameSharedStrings(shared, slotNames));
  } catch (e) {
    if (!/not found|ENOENT|missing|undefined/i.test(String(e?.message || e))) throw e;
  }
  // หมายเหตุ: ไม่เขียนชีต Summary อีกต่อไป — แม่แบบ v1.1+ มี Summary ที่สร้างใน Excel
  // สูตรของ Summary อ้างอิงคอลัมน์ตำแหน่งของ S50 จึงคำนวณต่อเองตอนเปิดไฟล์ (รองรับการเปลี่ยนชื่อแบบด้วยตำแหน่ง)
}

// ---------- หา path ของชีตจากชื่อ ----------
export function sheetPaths(workbookXml, relsXml) {
  const rid2t = {};
  for (const m of relsXml.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const tg = /Target="([^"]+)"/.exec(m[0]);
    if (id && tg) rid2t[id[1]] = tg[1];
  }
  const out = {};
  for (const m of workbookXml.matchAll(/<sheet\s[^>]*\/>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    if (name && rid && rid2t[rid]) out[name] = 'xl/' + rid2t[rid].replace(/^\/?(xl\/)?/, '');
  }
  return out;
}

// ---------- รวมทั้งหมด ----------
// getText(path) → Promise<string>, setText(path, string)
export async function fillWorkbook(io, pages, opening, aircraft = null) {
  const { getText, setText } = io;
  if (pages.length > MAX_PAGES) {
    throw new Error(`ข้อมูลเกิน ${MAX_PAGES * PAGE_SIZE} รายการ (${MAX_PAGES} ชีต) — ต้องเพิ่มชีตในแม่แบบก่อน`);
  }
  // รายการแบบอากาศยานไม่ใช่ค่าเริ่มต้น → ปรับสูตร/หัวคอลัมน์ในแม่แบบก่อนกรอก
  // (ชีต Summary สร้าง/คำนวณในไฟล์แม่แบบ ไม่ถูกเขียนทับด้วยโค้ดอีกต่อไป)
  if (aircraft && !isDefaultAircraft(aircraft)) await customizeTemplate(io, aircraft);
  const paths = sheetPaths(await getText('xl/workbook.xml'), await getText('xl/_rels/workbook.xml.rels'));
  // ทุกชีตใช้ช่อง Hours เป็นตัวเลขทศนิยม 0–24 ไม่ใช่ dropdown 0.1–5.0
  for (let n = 1; n <= MAX_PAGES; n++) {
    const path = paths[`S${n}`];
    if (!path) continue;
    setText(path, retargetHoursValidation(await getText(path)));
  }
  for (const p of pages) {
    const path = paths[`S${p.n}`];
    if (!path) throw new Error(`ไม่พบชีต S${p.n} ในแม่แบบ`);
    let values = pageValues(p);
    if (p.n === 1 && opening) values = { ...values, ...openingValues(opening) };
    setText(path, fillSheetXml(await getText(path), values));
  }
  // ยอดยกมาต้องใส่แม้ยังไม่มีเที่ยวบิน
  if (!pages.length && opening) {
    const path = paths.S1;
    setText(path, fillSheetXml(await getText(path), openingValues(opening)));
  }
}
