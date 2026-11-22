import { test, expect, type Page } from "@playwright/test";
import type { Profile } from "../src/types/database.types";
import {
  accountError,
  normalizeAccount,
  validatePassword,
} from "../src/lib/accounts/validation";

import {
  admin,
  pending,
  backend,
  fillAccount,
  nextAccountStep,
  submit,
} from "./accounts-fixture";

test("account validation normalizes identity and maps distinct conflict causes", () => {
  const value = normalizeAccount({
    employee_code: " test-123 ",
    full_name: " Name ",
    email: " PERSON@example.test ",
    phone: "",
    position: "",
    department: "",
    targetRole: "field_ranger",
    assigned_zone_ids: [],
    password: "Forest123!",
  });
  expect(value.employee_code).toBe("TEST-123");
  expect(value.email).toBe("person@example.test");
  expect(() => validatePassword("short")).toThrow();
  expect(accountError({ code: "23505" }).field).toBe("employee_code");
  expect(accountError({ code: "23503" }).message).toContain("อ้างอิง");
  expect(accountError({ code: "42501" }).message).toContain("สิทธิ์");
  expect(accountError({ code: "PGRST116" }).message).toContain("ไม่พบ");
});

test("three-step registration persists pending role without OTP and survives reload on mobile", async ({
  page,
}) => {
  const db = await backend(page);
  await page.setViewportSize({ width: 400, height: 947 });
  await fillAccount(page);
  await page.getByLabel("บทบาทที่เสนอ").selectOption("officer_backoffice");
  await expect(
    page.getByRole("list", { name: "ขั้นตอนลงทะเบียน" }).getByRole("listitem"),
  ).toHaveCount(3);
  await nextAccountStep(page).click();
  await expect(page.getByRole("heading", { name: /ขั้นตอนที่ 2/ })).toBeFocused();
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(page.locator("#full_name")).toHaveValue("เจ้าหน้าที่ทดสอบ");
  await expect(page.locator("#confirm_password")).toHaveValue("Forest123!");
  await nextAccountStep(page).click();
  await submit(page).dblclick();
  await expect(
    page.getByRole("heading", { name: "ตรวจและอนุมัติบัญชี", exact: true }),
  ).toBeVisible();
  expect(db.posts).toBe(1);
  expect(db.profiles[0].requested_role).toBe("officer_backoffice");
  expect(db.profiles[0].verification_status).toBe("pending");
  expect(db.profiles[0].otp_code).toBeNull();
  await page.getByRole("link", { name: "อนุมัติภายหลัง" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.reload();
  const row = page.getByRole("listitem").filter({ hasText: "เจ้าหน้าที่ทดสอบ" });
  await row.getByRole("button", { name: "ตั้งค่าบัญชี" }).click();
  const settings = page.getByRole("dialog", { name: "ตั้งค่าบัญชี" });
  await expect(settings).toContainText("เจ้าหน้าที่ทดสอบ");
  await settings.getByRole("button", { name: "ตรวจสอบและอนุมัติ" }).click();
  await page.getByRole("button", { name: "ย้อนกลับ", exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "ตรวจสอบและอนุมัติ" }).click();
  await expect(page.getByLabel("บทบาทที่จะเปิดใช้งาน")).toHaveValue(
    "officer_backoffice",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/accounts-review-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "อนุมัติเปิดใช้งาน", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "ตั้งค่าบัญชี" })).toBeVisible();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.reload();
  await expect(row).toContainText("ใช้งานอยู่");
  expect(db.profiles[0].role).toBe("officer_backoffice");
});

test("duplicate codes focus the field and do not create a local phantom account", async ({
  page,
}) => {
  const db = await backend(page);
  await fillAccount(page, "test-old");
  await nextAccountStep(page).click();
  await submit(page).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "มีบัญชีแล้ว",
  );
  await expect(page.locator("#employee_code")).toBeFocused();
  expect(db.posts).toBe(0);
  await page.getByRole("link", { name: "ค้นหาบัญชีเดิม" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("listitem")).toContainText("เจ้าหน้าที่เดิม");
});

for (const code of ["23505", "23503", "42501"]) {
  test(`insert failure ${code} preserves draft and allows retry`, async ({
    page,
  }) => {
    const db = await backend(page);
    await fillAccount(page);
    await nextAccountStep(page).click();
    db.fail = { method: "POST", code, status: code === "42501" ? 403 : 409 };
    await submit(page).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      code === "23505" ? "ซ้ำ" : code === "23503" ? "อ้างอิง" : "สิทธิ์",
    );
    await expect(page.locator("#full_name")).toHaveValue("เจ้าหน้าที่ทดสอบ");
    expect(db.profiles).toHaveLength(2);
    const cache = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("rakforest-operational-cache-v1") || "{}",
      ),
    );
    expect(
      cache.profiles?.some((p: Profile) => p.employee_code === "TEST-NEW") ??
        false,
    ).toBe(false);
    if (code === "23505") await nextAccountStep(page).click();
    await submit(page).click();
    await expect(
      page.getByRole("heading", { name: "ตรวจและอนุมัติบัญชี", exact: true }),
    ).toBeVisible();
  });
}

test("lost insert response retries with the same ID without creating a duplicate", async ({
  page,
}) => {
  const db = await backend(page);
  await fillAccount(page);
  await nextAccountStep(page).click();
  db.loseInsertResponse = true;
  await submit(page).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await submit(page).click();
  await expect(
    page.getByRole("heading", { name: "ตรวจและอนุมัติบัญชี", exact: true }),
  ).toBeVisible();
  expect(db.posts).toBe(1);
});

test("loading failure has retry and empty results never show seeds", async ({
  page,
}) => {
  const db = await backend(page, []);
  db.readsFail = true;
  await page.goto("/accounts");
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(0);
  db.readsFail = false;
  await page.getByRole("button", { name: "ลองโหลดใหม่" }).click();
  await expect(
    page.getByText("ยังไม่มีบัญชีเจ้าหน้าที่", { exact: true }),
  ).toBeVisible();
});

test("legacy pending account, failed approval, suspend and restore chosen role", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/accounts");
  const row = page.getByRole("listitem").filter({ hasText: "เจ้าหน้าที่เดิม" });
  await row.getByRole("button", { name: "ตรวจสอบและอนุมัติ" }).click();
  db.fail = { method: "PATCH", code: "23503", status: 409 };
  await page.getByRole("button", { name: "อนุมัติเปิดใช้งาน", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "อ้างอิง",
  );
  expect(db.profiles[1].role).toBe("pending_verification");
  await page.getByRole("button", { name: "อนุมัติเปิดใช้งาน", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "ตั้งค่าบัญชี" })).toBeVisible();
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await row.getByRole("button", { name: "ตั้งค่าบัญชี", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ระงับสิทธิ์", exact: true })
    .click();
  await page.getByRole("button", { name: "ยืนยันระงับสิทธิ์" }).click();
  await expect(row).toContainText("ระงับสิทธิ์");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "คืนสิทธิ์", exact: true })
    .click();
  await expect(page.getByLabel("บทบาทที่จะเปิดใช้งาน")).toHaveValue(
    "officer_backoffice",
  );
  await page.getByLabel("บทบาทที่จะเปิดใช้งาน").selectOption("field_ranger");
  await page.getByRole("button", { name: "อนุมัติเปิดใช้งาน", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("เจ้าหน้าที่ภาคสนาม");
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(row).toContainText("เจ้าหน้าที่ภาคสนาม");
  await page.getByRole("button", { name: /^รออนุมัติ/ }).click();
  await expect(
    page.getByText("ไม่พบเจ้าหน้าที่ตามเงื่อนไข", { exact: true }),
  ).toBeVisible();
});

test("password notification failure reports committed password accurately and dialog supports keyboard", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/accounts");
  const row = page.getByRole("listitem").filter({ hasText: "เจ้าหน้าที่เดิม" });
  const trigger = row.getByRole("button", { name: "ตั้งค่าบัญชี", exact: true });
  const passwordAction = page
    .getByRole("dialog")
    .getByRole("button", { name: "เปลี่ยนรหัสผ่าน", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText("เจ้าหน้าที่เดิม");
  await passwordAction.click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "ปิด", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "บันทึกรหัสผ่าน" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await passwordAction.click();
  await page.getByLabel("รหัสผ่านใหม่", { exact: true }).fill("Changed123!");
  db.notificationFails = true;
  await page.getByRole("button", { name: "บันทึกรหัสผ่าน" }).click();
  await expect(page.getByRole("status")).toContainText(
    "เปลี่ยนรหัสผ่านแล้ว แต่ส่งการแจ้งเตือนในระบบไม่สำเร็จ",
  );
  expect(db.profiles[1].password_hash).toBe("Changed123!");
});

test("invalid attachment and upload failure can be corrected without losing the form", async ({
  page,
}) => {
  const db = await backend(page);
  await fillAccount(page);
  await nextAccountStep(page).click();
  await page.getByLabel("ภาพบัตรเจ้าหน้าที่", { exact: true }).setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  });
  await submit(page).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("JPEG");
  expect(db.uploads).toBe(0);
  db.uploadFails = true;
  await page.getByLabel("ภาพบัตรเจ้าหน้าที่", { exact: true }).setInputFiles({
    name: "card.png",
    mimeType: "image/png",
    buffer: Buffer.from("png"),
  });
  await submit(page).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "อัปโหลดบัตรไม่สำเร็จ",
  );
  expect(db.posts).toBe(0);
  await page.getByRole("button", { name: "เอาไฟล์ออก" }).click();
  await submit(page).click();
  await expect(
    page.getByRole("heading", { name: "ตรวจและอนุมัติบัญชี", exact: true }),
  ).toBeVisible();
});

test("missing update row stays in dialog and does not report success", async ({
  page,
}) => {
  const db = await backend(page);
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "ตรวจสอบและอนุมัติ", exact: true })
    .click();
  db.fail = { method: "PATCH", code: "PGRST116", status: 406 };
  await page.getByRole("button", { name: "อนุมัติเปิดใช้งาน", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "ไม่พบบัญชี",
  );
  expect(db.profiles[1].role).toBe("pending_verification");
});

test("old verification route requires no OTP or account list", async ({
  page,
}) => {
  await backend(page);
  await page.goto("/verify");
  await expect(
    page.getByRole("heading", { name: "รอผู้ดูแลตรวจและอนุมัติบัญชี" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("private legacy card uses signed link and form fits a 390px screen", async ({
  page,
}) => {
  const cardProfile = {
    ...pending,
    id_card_file_url:
      "https://example.supabase.co/storage/v1/object/public/employee-ids/test.png",
  };
  await backend(page, [admin, cardProfile]);
  await page.goto("/accounts");
  await page
    .getByRole("button", { name: "ตรวจสอบและอนุมัติ", exact: true })
    .click();
  await page.getByRole("button", { name: "ดูบัตรเจ้าหน้าที่" }).click();
  await expect(page.getByRole("link", { name: /เปิดภาพบัตร/ })).toHaveAttribute(
    "href",
    /object\/sign\/employee-ids/,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "test-results/accounts-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await fillAccount(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/accounts-new-mobile.png",
    fullPage: true,
  });
});
