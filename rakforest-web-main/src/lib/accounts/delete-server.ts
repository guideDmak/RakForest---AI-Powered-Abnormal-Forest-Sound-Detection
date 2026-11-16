import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type DeleteInput = {
  kind: "profile" | "station" | "zone";
  targetId: string;
  actorId: string;
  password: string;
};
export class DeleteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseDeleteInput(value: unknown): DeleteInput {
  if (!value || typeof value !== "object")
    throw new DeleteError("ข้อมูลไม่ถูกต้อง", 400);
  const v = value as Record<string, unknown>;
  if (
    (v.kind !== "profile" && v.kind !== "station" && v.kind !== "zone") ||
    typeof v.targetId !== "string" ||
    !uuid.test(v.targetId) ||
    typeof v.actorId !== "string" ||
    !uuid.test(v.actorId) ||
    typeof v.password !== "string" ||
    !v.password ||
    v.password.length > 1024
  )
    throw new DeleteError("กรุณาระบุข้อมูลและรหัสผ่านของคุณให้ครบ", 400);
  return v as DeleteInput;
}
export function samePassword(actual: string, expected: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(actual).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
export async function deleteDirectory(input: DeleteInput) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
    /\/rest\/v1\/?$/,
    "",
  );
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new DeleteError("เซิร์ฟเวอร์ยังไม่พร้อมยืนยันการลบ กรุณาติดต่อผู้ดูแล", 503);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: actor, error } = await client
    .from("profiles")
    .select("id,role,password_hash,deleted_at")
    .eq("id", input.actorId)
    .single();
  if (error || !actor || actor.deleted_at || actor.role !== "super_admin")
    throw new DeleteError("ไม่มีสิทธิ์ลบข้อมูล", 403);
  if (
    !actor.password_hash ||
    !samePassword(input.password, actor.password_hash)
  )
    throw new DeleteError("รหัสผ่านของคุณไม่ถูกต้อง", 401);
  const { data, error: deleteError } = await client.rpc(
    "soft_delete_directory",
    {
      p_kind: input.kind,
      p_target: input.targetId,
      p_actor: actor.id,
      p_password_version: createHash("md5")
        .update(actor.password_hash)
        .digest("hex"),
    },
  );
  if (deleteError) {
    const status =
      deleteError.code === "P0002"
        ? 404
        : deleteError.code === "42501"
          ? 403
          : deleteError.code === "28000"
            ? 401
            : 409;
    throw new DeleteError(
      ["P0001", "P0002", "42501", "28000"].includes(deleteError.code)
        ? deleteError.message
        : "ลบไม่สำเร็จ ข้อมูลอาจเปลี่ยนแล้ว กรุณาโหลดรายการใหม่",
      status,
    );
  }
  return data as {
    deleted?: boolean;
    alreadyDeleted?: boolean;
    blocked?: boolean;
    items?: { id: string; name: string; kind: "report" | "zone" | "station" }[];
  };
}
