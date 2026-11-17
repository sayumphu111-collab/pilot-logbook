// ใส่ค่าจาก Firebase Console → Project settings → Your apps → Web app → SDK setup (Config)
// ค่าเหล่านี้ไม่ใช่รหัสลับ ความปลอดภัยของข้อมูลมาจากกฎใน firestore.rules + การล็อกอิน Google
// ถ้ายังไม่แก้ แอปจะทำงานใน "โหมดในเครื่อง" (เก็บในเบราว์เซอร์เครื่องนี้ ยังไม่ซิงค์)
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  appId: 'YOUR_APP_ID',
};
