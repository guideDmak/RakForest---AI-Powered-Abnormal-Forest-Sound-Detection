import type { ActiveRole } from "./validation";
export const positions: {
  name: string;
  role: ActiveRole;
  department: string;
}[] = [
  {
    name: "เจ้าหน้าที่พิทักษ์ป่าภาคสนาม",
    role: "field_ranger",
    department: "หน่วยพิทักษ์ป่าแม่ริม–สะเมิง",
  },
  {
    name: "หัวหน้าชุดลาดตระเวนเคลื่อนที่เร็ว",
    role: "field_ranger",
    department: "ชุดปฏิบัติการพิเศษป่าสงวนแม่แตง",
  },
  {
    name: "นักวิชาการป่าไม้ปฏิบัติการ (เวรศูนย์สั่งการ)",
    role: "officer_backoffice",
    department: "ศูนย์ปฏิบัติการเฝ้าระวังไฟป่าและทรัพยากรป่าไม้",
  },
  {
    name: "เจ้าหน้าที่วิเคราะห์ข้อมูล GIS และตรวจจับเสียง",
    role: "officer_backoffice",
    department: "กลุ่มงานระบบภูมิสารสนเทศและเทคโนโลยีเสียง AI",
  },
  {
    name: "เจ้าหน้าที่เทคโนโลยีและระบบเครือข่ายเซนเซอร์",
    role: "officer_backoffice",
    department: "ฝ่ายเทคโนโลยีสารสนเทศและเสาไมโครโฟน",
  },
  {
    name: "ผู้อำนวยการศูนย์เฝ้าระวังไฟป่าและทรัพยากรป่าไม้",
    role: "super_admin",
    department: "ส่วนควบคุมและปฏิบัติการไฟป่า (ส่วนกลาง)",
  },
  {
    name: "อาสาสมัครพิทักษ์ป่าชุมชน",
    role: "field_ranger",
    department: "เครือข่ายอาสาสมัครป่าชุมชนห้วยตึงเฒ่า",
  },
  {
    name: "เจ้าหน้าที่ประสานงานและธุรการ",
    role: "officer_backoffice",
    department: "ฝ่ายอำนวยการและธุรการประจำศูนย์",
  },
];
