# Pilot Logbook B1 — Data Model v2 Development Build

สถานะ: Development build ที่ผ่านการทดสอบ **33/33** และส่งออก Excel ได้แล้ว ยังไม่ประกาศเป็น Production แบบสมบูรณ์ — ยังรองาน P2-1 (คุมสิทธิ์ Firestore) และการทดสอบ end-to-end บน Firebase project จริง

## สรุปแพตช์ล่าสุด

- **โมเดล SIM:** แยก `hours` (ชั่วโมงบินจริง) ออกจาก `loggedHours` (ชั่วโมงที่กรอกทั้งหมด) SIM หน้าที่ `SP` นับเป็นชั่วโมงบินจริงตั้งแต่เป็นนักเรียน; SIM หน้าที่ `CP/PI`, `PC`, `MP`, `IP` อยู่ในยอดจำลอง/ยอดที่กรอก แต่ไม่นับเข้า `hours`, ยอดต่อหน้า หรือ `Q`
- **หน้าสรุปในแอป:** แสดงยอด SIM แยกตามหน้าที่เป็นหมายเหตุใต้ตารางเดิม ไม่เพิ่มตารางใหม่ และไม่นำ SIM นอก `SP` ไปบวกกับชั่วโมงเครื่องจริง
- **Excel `Summary`:** แถว SIM แสดงทุก Duty แยกกัน; แถว 20 หักแถว SIM ออก; `Q20 = SUM(O20:P20,H12)` ตรงกับชั่วโมงบินรวมในแอป; `N12 = 'S50'!S24` ยังเป็นยอด SIM เต็ม; คอลัมน์ซ่อน `DG` เก็บ logged hours
- **P0:** แก้เคสออฟไลน์แล้วบันทึกแล้วหายหลัง refresh (`list.map(L.sanitizeFlight)` ส่ง `index` เป็น aircraft list) และแยกสถานะ `error` ออกจาก `offline` ใน `backend.js` (ใช้ `onSnapshot()` แบบไม่ถอด)
- **P1-1/2/3:** ใช้ `aircraftId` เป็น primary key; ยอดยกมาขัดกันขึ้น `OPENING_CONFLICT`; เติม `ord` ที่หายและให้ `sortFlights()` fallback `date → id`
- **ตาราง Excel:** เปลี่ยนสีพื้นหลังแถว 11 ของ `Summary` ให้ตรงกับแถว 13 ครบ `B:Q` โดยยังคงสูตรเดิม
- **แพ็กเกจ:** rezip `template.xlsx` ให้ใช้ entry path แบบ `/` (`xl/workbook.xml`) เพื่อให้ JSZip/open export ไม่ขึ้น `Not found`; `sw.js` บั้มป์เป็น `pilot-logbook-v9-slash-paths`

## สิ่งที่เปลี่ยนแปลงตั้งแต่ Data Model v2

- Aircraft v2: `id`, `name`, `kind`, `duties`, `active`, `sortOrder` และใช้ Stable Aircraft ID เชื่อม Flight/Opening (เก็บ `type` ไว้เพื่อ backward compatibility)
- Flight Duty แยกตาม Aircraft; ปิดใช้งาน Aircraft แทนการลบ; Legacy Duty ไม่ถูกแปลงเป็น CP/PI อัตโนมัติและขึ้น Data Quality
- Decimal Hours 1 ตำแหน่ง คำนวณด้วย integer tenths ค่าความละเอียดผิดข้อกำหนดคงต้นฉบับและขึ้น Data Quality issue โดยไม่ปัดเศษ/ไม่นำมารวม
- Migration v1 → v2 มี Preview → JSON Backup → Commit และรอ Firebase streams ให้ sync สำเร็จ + ไม่มี pending writes
- Dynamic Excel: เพิ่ม `Aircraft Summary` และ `Data Quality` อัตโนมัติ รองรับ Aircraft เกิน 8 แบบและ Duty เพิ่มเติม; ใช้ named range `AircraftTypeList` สำหรับ dropdown
- Hidden helper `DE` = Aircraft ID, `DF` = marker 0.1 ชม., `DG` = logged hours; สูตร Dynamic Summary aggregate ด้วย ID ไม่ใช่ชื่อที่แก้ได้
- ปรับโครงสร้างชีต S1–S50 ให้เขียนชั่วโมงจริงลง `I` และชั่วโมงที่กรอกทั้งหมดลง `DG`

## ผลทดสอบล่าสุด

คำสั่ง: `node --test tests/*.test.mjs`

ผลล่าสุด: **33 tests passed, 0 failed**

ตรวจเพิ่มเติม: hash ของ `firebase-config.js` ยังเป็น `41608F2DCC48C2A49A990C96225B656693AD551FD30CADCD07C6829B916AA131`; ตรวจ `template.xlsx` ว่า entry path เป็น `/`, มี `xl/workbook.xml` และ 51 ชีต; ตรวจสีแถว 11/13 ใน `Summary` ตรงกันและ `rebuildSummary()` ไม่เขียนทับสี

## สิ่งที่ยังค้าง

- **P2-1:** ยังไม่เลือกโมเดลคุมสิทธิ์ระหว่าง email allowlist กับ custom claims และยังไม่ได้รับรายชื่ออีเมล/UID จึงยังไม่แก้ `firestore.rules` จริง (กฎปัจจุบันคือเจ้าของข้อมูลเข้าถึงเฉพาะ `users/{uid}` ของตัวเอง)
- เอกสาร `README.md` และไฟล์นี้เพิ่งอัปเดตให้ตรงโมเดล SIM/Excel แล้ว แต่ยังควรทบทวนก่อนปล่อยให้ผู้ใช้ภายนอก
- ยังไม่มี Git repository/commit history สำหรับ workspace นี้; เก็บสำรองเป็น ZIP ตามรุ่นแทนไปก่อน
- ยังไม่ได้ทดสอบ end-to-end บน Firebase project จริง/อุปกรณ์จริงทุกแพลตฟอร์ม (โดยเฉพาะการล็อกอินใน PWA บน iOS)

## ความปลอดภัยของไฟล์

ไฟล์ต้นฉบับ ZIP ไม่ถูกแก้ไข การพัฒนาทั้งหมดทำในสำเนาแยกต่างหาก `firebase-config.js` ไม่ถูกแตะและ hash ตรงกับเดิมทุกครั้งหลัง rebuild

## ประวัติการพัฒนา (ย่อ)

- Data Model v2 เบื้องต้น: 14/14 → 19/19 → **33/33** ตามลำดับแพตช์
- Dynamic Aircraft Summary เดิม aggregate ด้วยชื่อ/จำกัด 8 ช่อง → ปัจจุบันใช้ ID, hidden `DE:DF:DG` และรองรับ Aircraft/Duty เกินแม่แบบเดิม
- Excel Summary เดิมให้ SIM เข้า C:H ทุก Duty → ปัจจุบันแยก Duty, หักแถว SIM ออกจากยอดรวม และให้ `Q20` เป็นชั่วโมงบินจริงตามโมเดล `SP`
