import { createClient } from "@/lib/supabase/client";
import type { Profile, UserNotification } from "@/types/database.types";
import {
  AccountError,
  accountError,
  accountRoles,
  normalizeAccount,
  validateCard,
  validatePassword,
  type ActiveRole,
  type CreateAccountInput,
} from "./validation";

export async function listAccounts(): Promise<Profile[]> {
  const { data, error } = await createClient()
    .from("profiles")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .retry(false);
  if (error) throw accountError(error);
  return data as Profile[];
}
export async function requireAccountAdmin(actorId?: string): Promise<Profile> {
  if (!actorId) throw new AccountError("กรุณาเข้าสู่ระบบผู้ดูแลก่อนดำเนินการ");
  const { data, error } = await createClient()
    .from("profiles")
    .select("*")
    .eq("id", actorId)
    .single();
  if (error) throw accountError(error);
  if (data.deleted_at || data.role !== "super_admin")
    throw new AccountError("เฉพาะผู้ดูแลระบบเท่านั้นที่จัดการบัญชีได้");
  return data as Profile;
}
export async function createAccountRecord(
  input: CreateAccountInput,
  id: string,
): Promise<Profile> {
  const value = normalizeAccount(input);
  const client = createClient();
  // A stable draft ID makes a retry safe when the previous response was lost.
  const { data: previous, error: previousError } = await client
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (previousError) throw accountError(previousError);
  if (previous) return previous as Profile;
  const { data: existing, error: lookupError } = await client
    .from("profiles")
    .select("id")
    .ilike("employee_code", value.employee_code)
    .limit(1);
  if (lookupError) throw accountError(lookupError);
  if (existing?.length)
    throw new AccountError(
      "รหัสเจ้าหน้าที่นี้มีบัญชีแล้ว กรุณาใช้รหัสอื่น หรือเปิดบัญชีเดิม",
      "employee_code",
    );
  const { targetRole, password, ...fields } = value;
  const { data, error } = await client
    .from("profiles")
    .insert({
      ...fields,
      id,
      role: "pending_verification",
      verification_status: "pending",
      requested_role: targetRole,
      password_hash: password,
      otp_code: null,
      otp_expires_at: null,
    })
    .select("*")
    .single();
  if (error) throw accountError(error);
  return data as Profile;
}
export async function changeAccountRole(
  profileId: string,
  role: ActiveRole | "suspended",
  actor: Profile,
): Promise<Profile> {
  if (role !== "suspended" && !Object.hasOwn(accountRoles, role))
    throw new AccountError("บทบาทไม่ถูกต้อง");
  const client = createClient();
  const { data: current, error: readError } = await client
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .is("deleted_at", null)
    .single();
  if (readError) throw accountError(readError);
  if (current.role === "suspended" && role === "suspended")
    return current as Profile;
  if (current.role === "super_admin" && role === "suspended")
    throw new AccountError("ไม่สามารถระงับบัญชีผู้ดูแลระบบจากหน้านี้ได้");
  const { data, error } = await client
    .from("profiles")
    .update({
      role,
      verification_status: role === "suspended" ? "rejected" : "approved",
      requested_role:
        role === "suspended"
          ? current.role === "pending_verification"
            ? current.requested_role
            : current.role
          : role,
      approved_by: actor.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      otp_code: null,
      otp_expires_at: null,
    })
    .eq("id", profileId)
    .is("deleted_at", null)
    .eq("role", current.role)
    .select("*")
    .single();
  if (error) throw accountError(error);
  return data as Profile;
}
export async function resetAccountPassword(input: {
  userId: string;
  newPassword: string;
  notifyUser?: boolean;
}): Promise<{
  profile: Profile;
  notification?: UserNotification;
  notificationStatus: "sent" | "failed" | "skipped";
}> {
  validatePassword(input.newPassword);
  const client = createClient();
  const { data, error } = await client
    .from("profiles")
    .update({
      password_hash: input.newPassword,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.userId)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw accountError(error);
  const profile = data as Profile;
  if (!input.notifyUser) return { profile, notificationStatus: "skipped" };
  // The password is committed. Notification failure must never invite a duplicate reset.
  try {
    const { data: notification, error: notificationError } = await client
      .from("user_notifications")
      .insert({
        id: crypto.randomUUID(),
        user_id: profile.id,
        title: "ผู้ดูแลเปลี่ยนรหัสผ่านของคุณแล้ว",
        message: "หากไม่ได้เป็นผู้ร้องขอ กรุณาติดต่อผู้ดูแลระบบ",
        type: "security_alert",
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (notificationError) return { profile, notificationStatus: "failed" };
    return {
      profile,
      notification: notification as UserNotification,
      notificationStatus: "sent",
    };
  } catch {
    return { profile, notificationStatus: "failed" };
  }
}
export async function uploadAccountCard(file: File): Promise<string> {
  validateCard(file);
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
    file.type
  ];
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient()
    .storage.from("employee-ids")
    .upload(path, file, { upsert: false });
  if (error)
    throw new AccountError(
      "อัปโหลดบัตรไม่สำเร็จ กรุณาลองใหม่ หรือเอาไฟล์ออกเพื่อบันทึกโดยไม่แนบบัตร",
      "id_card",
    );
  return path;
}
export async function accountCardUrl(stored: string): Promise<string> {
  // Older records stored a public URL even though employee-ids is private.
  const marker = "/employee-ids/";
  let path = stored;
  if (/^https?:\/\//.test(stored)) {
    const url = new URL(stored);
    if (!url.pathname.includes(marker))
      throw new AccountError("ตำแหน่งไฟล์บัตรไม่ถูกต้อง");
    path = decodeURIComponent(url.pathname.split(marker)[1]);
  }
  const { data, error } = await createClient()
    .storage.from("employee-ids")
    .createSignedUrl(path, 300);
  if (error) throw new AccountError("เปิดไฟล์บัตรไม่สำเร็จ กรุณาลองใหม่");
  return data.signedUrl;
}

export async function reserveEmployeeCode(): Promise<string> {
  const { data, error } = await createClient().rpc("reserve_employee_code");
  if (error) throw accountError(error);
  if (typeof data !== "string")
    throw new AccountError("สร้างรหัสอัตโนมัติไม่สำเร็จ");
  return data;
}
export async function updateEmployeeCode(
  id: string,
  code: string,
): Promise<Profile> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,49}$/.test(clean))
    throw new AccountError(
      "ระบุรหัส 2–50 ตัว ใช้อักษรอังกฤษ ตัวเลข หรือขีดกลาง",
    );
  const client = createClient();
  const { data: duplicates, error: lookupError } = await client
    .from("profiles")
    .select("id")
    .ilike("employee_code", clean)
    .neq("id", id)
    .limit(1);
  if (lookupError) throw accountError(lookupError);
  if (duplicates?.length)
    throw new AccountError("รหัสเจ้าหน้าที่ซ้ำกับบัญชีเดิม");
  const { data, error } = await client
    .from("profiles")
    .update({ employee_code: clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("*")
    .single();
  if (error) throw accountError(error);
  return data as Profile;
}
