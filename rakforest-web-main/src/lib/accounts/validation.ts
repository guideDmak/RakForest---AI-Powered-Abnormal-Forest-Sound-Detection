import type { UserRole } from "@/types/database.types";

export type ActiveRole = Extract<
  UserRole,
  "field_ranger" | "officer_backoffice" | "super_admin"
>;
export const accountRoles: Record<ActiveRole, string> = {
  field_ranger: "เจ้าหน้าที่ภาคสนาม",
  officer_backoffice: "เจ้าหน้าที่ส่วนกลาง",
  super_admin: "ผู้ดูแลระบบ",
};
export class AccountError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}
export function accountError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AccountError {
  if (error.code === "23505")
    return new AccountError(
      "ข้อมูลบัญชีซ้ำ กรุณาตรวจสอบรหัสเจ้าหน้าที่ หรือเปิดบัญชีเดิม",
      "employee_code",
    );
  if (error.code === "23503")
    return new AccountError(
      "ข้อมูลอ้างอิงไม่ถูกต้อง กรุณาโหลดข้อมูลผู้ดูแลและพื้นที่ใหม่แล้วลองอีกครั้ง",
    );
  if (error.code === "42501")
    return new AccountError("ไม่มีสิทธิ์ดำเนินการ กรุณาติดต่อผู้ดูแลระบบ");
  if (error.code === "PGRST116")
    return new AccountError(
      "ไม่พบบัญชี หรือสถานะบัญชีเปลี่ยนแล้ว กรุณาโหลดรายการใหม่",
    );
  if (error.code === "PGRST204" || error.code === "42703")
    return new AccountError(
      "โครงสร้างฐานข้อมูลยังไม่พร้อม กรุณาให้ผู้ดูแลติดตั้ง migration บัญชีเจ้าหน้าที่",
    );
  return new AccountError(
    "ติดต่อฐานข้อมูลไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่",
  );
}
export function validatePassword(password: string) {
  if (
    password.length < 8 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new AccountError(
      "ใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข",
      "password",
    );
  }
}
export interface CreateAccountInput {
  employee_code: string;
  full_name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  targetRole: ActiveRole;
  assigned_zone_ids: string[];
  password: string;
  id_card_file_url?: string | null;
}
export function normalizeAccount(
  input: CreateAccountInput,
): CreateAccountInput {
  const value = {
    ...input,
    employee_code: input.employee_code.trim().toUpperCase(),
    full_name: input.full_name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    position: input.position.trim(),
    department: input.department.trim(),
  };
  if (!/^[A-Z0-9][A-Z0-9-]{1,49}$/.test(value.employee_code))
    throw new AccountError(
      "ระบุรหัส 2–50 ตัว ใช้อักษรอังกฤษ ตัวเลข หรือขีดกลาง",
      "employee_code",
    );
  if (!value.full_name)
    throw new AccountError("กรุณาระบุชื่อ–นามสกุล", "full_name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
    throw new AccountError("กรุณาระบุอีเมลให้ถูกต้อง", "email");
  if (!Object.hasOwn(accountRoles, value.targetRole))
    throw new AccountError("กรุณาเลือกบทบาทที่ถูกต้อง", "targetRole");
  validatePassword(value.password);
  return value;
}
export function validateCard(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 5 * 1024 * 1024
  ) {
    throw new AccountError(
      "ใช้ภาพ JPEG, PNG หรือ WebP ขนาดไม่เกิน 5 MB",
      "id_card",
    );
  }
}
