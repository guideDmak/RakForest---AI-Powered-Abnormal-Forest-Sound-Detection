import { expect, type Page } from "@playwright/test";
import type { Profile } from "../src/types/database.types";
export const admin: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  employee_code: "TEST-ADMIN",
  full_name: "ผู้ดูแลทดสอบ",
  email: "admin@example.test",
  phone: null,
  position: null,
  department: null,
  role: "super_admin",
  assigned_zone_ids: [],
  id_card_file_url: null,
  verification_status: "approved",
  created_at: "2026-11-15T00:00:00Z",
  updated_at: "2026-11-15T00:00:00Z",
};
export const pending: Profile = {
  ...admin,
  id: "00000000-0000-4000-8000-000000000002",
  employee_code: "TEST-OLD",
  full_name: "เจ้าหน้าที่เดิม",
  role: "pending_verification",
  verification_status: "otp_sent",
  requested_role: "officer_backoffice",
};
type Failure = { method: string; code: string; status: number };
export async function backend(
  page: Page,
  initial: Profile[] = [admin, pending],
) {
  const state = {
    profiles: structuredClone(initial),
    fail: undefined as Failure | undefined,
    notificationFails: false,
    uploadFails: false,
    posts: 0,
    patches: 0,
    uploads: 0,
    readsFail: false,
    sequence: 0,
    loseInsertResponse: false,
  };
  await page.addInitScript(
    (profile) =>
      localStorage.setItem(
        "rakforest-active-profile-v1",
        JSON.stringify(profile),
      ),
    admin,
  );
  await page.route("**/*.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (url.pathname.endsWith("/rpc/reserve_employee_code"))
      return reply(`RF-EMP-${String(++state.sequence).padStart(4, "0")}`);
    if (url.pathname.includes("/auth/"))
      return reply({ message: "No session" }, 401);
    if (url.pathname.includes("/storage/")) {
      if (url.pathname.includes("/sign/"))
        return reply({
          signedURL: "/object/sign/employee-ids/test.png?token=test",
        });
      state.uploads++;
      return state.uploadFails
        ? reply({ message: "Upload unavailable" }, 503)
        : reply({ Key: "employee-ids/test.png" });
    }
    if (url.pathname.endsWith("/forest_zones")) return reply([]);
    if (url.pathname.endsWith("/user_notifications"))
      return method === "GET"
        ? reply([])
        : state.notificationFails
          ? reply({ code: "42501", message: "denied" }, 403)
          : reply(request.postDataJSON());
    if (!url.pathname.endsWith("/profiles")) return reply([]);
    if (url.searchParams.get("id") === "eq." + admin.id && method === "GET")
      return reply(admin);
    if (state.readsFail && method === "GET")
      return reply({ code: "503", message: "unavailable" }, 503);
    if (state.fail?.method === method) {
      const failure = state.fail;
      state.fail = undefined;
      return reply(
        { code: failure.code, message: "Injected failure" },
        failure.status,
      );
    }
    if (method === "POST") {
      state.posts++;
      const input = request.postDataJSON();
      const profile = {
        ...input,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.profiles.unshift(profile);
      if (state.loseInsertResponse) {
        state.loseInsertResponse = false;
        return route.abort("failed");
      }
      return reply(profile, 201);
    }
    let matches = state.profiles.filter((p) => {
      const id = url.searchParams.get("id"),
        role = url.searchParams.get("role"),
        code = url.searchParams.get("employee_code");
      return (
        (!id || p.id === id.slice(3)) &&
        (!role || p.role === role.slice(3)) &&
        (!code ||
          p.employee_code?.toUpperCase() ===
            code.replace(/^(eq|ilike)\./, "").toUpperCase())
      );
    });
    if (method === "PATCH") {
      state.patches++;
      const changes = request.postDataJSON();
      if (!matches.length)
        return reply({ code: "PGRST116", message: "No rows" }, 406);
      Object.assign(matches[0], changes);
      return reply(matches[0]);
    }
    if (url.searchParams.has("limit"))
      matches = matches.slice(0, Number(url.searchParams.get("limit")));
    const single = request.headers()["accept"]?.includes("vnd.pgrst.object");
    return reply(single ? (matches[0] ?? null) : matches);
  });
  return state;
}
export async function fillAccount(page: Page, code = "TEST-NEW") {
  await page.goto("/accounts/new");
  await page.getByLabel("รหัสเจ้าหน้าที่", { exact: false }).fill(code);
  await page.getByLabel("ชื่อ–นามสกุล", { exact: false }).fill("เจ้าหน้าที่ทดสอบ");
  await page.getByLabel("อีเมล", { exact: false }).fill("ranger@example.test");
  await page.locator("#password").fill("Forest123!");
  await page.locator("#confirm_password").fill("Forest123!");
}
export const nextAccountStep = (page: Page) =>
  page.getByRole("button", { name: "ถัดไป: แนบบัตรเจ้าหน้าที่", exact: true });
export const submit = (page: Page) =>
  page.getByRole("button", { name: "บันทึกเพื่อรออนุมัติ", exact: true });
