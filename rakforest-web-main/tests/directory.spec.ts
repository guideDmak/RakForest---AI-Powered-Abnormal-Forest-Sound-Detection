import { test, expect } from "@playwright/test";
import { backend, admin, fillAccount } from "./accounts-fixture";
import {
  validatePolygon,
  calculatePolygonAreaRai,
  pointWithinBoundary,
} from "../src/lib/utils/geo";
import {
  samePassword,
  parseDeleteInput,
} from "../src/lib/accounts/delete-server";
import { readFileSync } from "node:fs";

test("geometry rejects crossing, duplicate, nonfinite and zero-area boundaries", () => {
  const valid: [number, number][] = [
    [98, 18],
    [98.01, 18],
    [98.01, 18.01],
    [98, 18.01],
  ];
  expect(validatePolygon([...valid, valid[0]])).toEqual(valid);
  expect(calculatePolygonAreaRai(valid)).toBeGreaterThan(0);
  expect(pointWithinBoundary([98, 18], valid)).toBe(true);
  for (const points of [
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 0],
    ],
    [
      [Infinity, 0],
      [1, 0],
      [0, 1],
    ],
  ] as [number, number][][])
    expect(() => validatePolygon(points)).toThrow();
  expect(
    calculatePolygonAreaRai([
      [0, 0],
      [1, 1],
      [2, 2],
    ]),
  ).toBeGreaterThanOrEqual(0);
  expect(samePassword("Admin123!", "Admin123!")).toBe(true);
  expect(samePassword("bad", "Admin123!")).toBe(false);
  expect(() =>
    parseDeleteInput({
      kind: "profile",
      password: "",
      actorId: admin.id,
      targetId: admin.id,
    }),
  ).toThrow();
});

test("automatic code, restored position presets and editable account code", async ({
  page,
}) => {
  const db = await backend(page);
  await fillAccount(page);
  await page
    .getByRole("combobox", { name: "ตำแหน่งหน้าที่", exact: true })
    .selectOption("หัวหน้าชุดลาดตระเวนเคลื่อนที่เร็ว");
  await expect(page.getByLabel("หน่วยงาน", { exact: false })).toHaveValue(
    "ชุดปฏิบัติการพิเศษป่าสงวนแม่แตง",
  );
  await page
    .getByRole("combobox", { name: "ตำแหน่งหน้าที่", exact: true })
    .selectOption("other");
  await page.getByLabel("ระบุตำแหน่ง", { exact: true }).fill("ผู้ประสานงาน");
  await page.goto("/accounts/new");
  await expect(page.locator("#employee_code")).toHaveValue(/^RF-EMP-\d{4}$/);
  expect(db.sequence).toBeGreaterThan(0);
  await page.goto("/accounts");
  const row = page.getByRole("listitem").filter({ hasText: "เจ้าหน้าที่เดิม" });
  await row.getByRole("button", { name: "ตั้งค่าบัญชี", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "แก้ไขรหัสเจ้าหน้าที่" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("รหัสเจ้าหน้าที่", { exact: true })
    .fill("TEST-EDIT");
  await page.getByRole("button", { name: "บันทึกรหัสเจ้าหน้าที่" }).click();
  await expect(page.getByRole("dialog", { name: "ตั้งค่าบัญชี" })).toContainText(
    "TEST-EDIT",
  );
  await expect(row).toContainText("TEST-EDIT");
});

test("deletion asks current password each time, keeps blocked links, removes only after success", async ({
  page,
}) => {
  await backend(page);
  let calls = 0;
  await page.route("**/api/directory/delete", async (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.actorId).toBe(admin.id);
    const result =
      calls === 1
        ? { message: "รหัสผ่านของคุณไม่ถูกต้อง" }
        : calls === 2
          ? {
              blocked: true,
              items: [{ id: "task", name: "RF-TEST", kind: "report" }],
            }
          : { deleted: true };
    await route.fulfill({
      status: calls < 3 ? (calls === 1 ? 401 : 409) : 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.goto("/accounts");
  const row = page.getByRole("listitem").filter({ hasText: "เจ้าหน้าที่เดิม" });
  await row.getByRole("button", { name: "ตั้งค่าบัญชี", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ลบเจ้าหน้าที่" })
    .click();
  const password = page.getByLabel("รหัสผ่านของคุณ", { exact: true });
  await password.fill("bad");
  await page.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "ไม่ถูกต้อง",
  );
  await expect(password).toHaveValue("");
  await password.fill("correct");
  await page.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(page.getByRole("link", { name: "งาน: RF-TEST" })).toBeVisible();
  await expect(row).toHaveCount(1);
  await password.fill("correct");
  await page.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toBeFocused();
  const other = page.getByRole("listitem").first();
  await other.getByRole("button", { name: "ตั้งค่าบัญชี", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ลบเจ้าหน้าที่" })
    .click();
  await expect(password).toHaveValue("");
});

async function zoneBackend(page: import("@playwright/test").Page) {
  await backend(page);
  const zone = {
    id: "11111111-1111-4111-8111-111111111101",
    zone_code: "ZN-TEST",
    name: "ป่าอนุรักษ์ทดสอบ",
    polygon_coords: [
      [98.76, 18.12],
      [98.78, 18.12],
      [98.78, 18.14],
      [98.76, 18.14],
    ],
    area_rai: 100,
    province: "เชียงใหม่",
    district: "แม่ริม",
    current_risk_level: "green",
    responsible_officer_id: null,
    description: "",
    created_at: "2026-11-15",
    updated_at: "2026-11-15",
  };
  const station = {
    id: "22222222-2222-4222-8222-222222222201",
    station_code: "ST-TEST",
    name: "ไมค์ทดสอบ",
    zone_id: zone.id,
    lat: 18.13,
    lng: 98.77,
    radius_meters: 350,
    status: "online",
    battery_percent: 100,
  };
  const state = { zones: [zone], stations: [station], fail: false, saves: 0 };
  await page.route("**/rest/v1/forest_zones*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: state.zones });
    state.saves++;
    if (state.fail)
      return route.fulfill({ status: 409, json: { code: "23505" } });
    const input = route.request().postDataJSON();
    const saved = { ...zone, ...input };
    state.zones = [saved];
    return route.fulfill({ json: saved });
  });
  await page.route("**/rest/v1/sensor_stations*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: state.stations });
    if (state.fail)
      return route.fulfill({ status: 409, json: { code: "23505" } });
    Object.assign(station, route.request().postDataJSON());
    return route.fulfill({ json: station });
  });
  await page.route("**/api/directory/delete", async (route) => {
    state.stations = [];
    return route.fulfill({ json: { deleted: true } });
  });
  await page.route("https://tile.openstreetmap.org/**", (r) =>
    r.fulfill({
      contentType: "image/png",
      body: readFileSync("tests/fixtures/map-tile.png"),
    }),
  );
  return state;
}

test("station can detach, reload, reassign and delete without removing historical identity", async ({
  page,
}) => {
  const db = await zoneBackend(page);
  await page.goto("/zones");
  const stationTab = page.getByRole("tab", { name: /^เสาไมค์/ });
  await stationTab.click();
  const row = page
    .getByRole("article")
    .filter({ hasText: "ST-TEST · ไมค์ทดสอบ" });
  await row.getByRole("button", { name: "แก้ไขไมค์" }).click();
  await page
    .getByRole("combobox", { name: "สังกัดโซนป่าไม้", exact: true })
    .selectOption("");
  await page.getByRole("button", { name: "บันทึกไมค์", exact: true }).click();
  await expect(row).toContainText("ไม่สังกัดโซน");
  expect(db.stations[0].zone_id).toBeNull();
  await page.reload();
  await stationTab.click();
  await expect(row).toContainText("ไม่สังกัดโซน");
  await row.getByRole("button", { name: "แก้ไขไมค์" }).click();
  await page
    .getByRole("combobox", { name: "สังกัดโซนป่าไม้", exact: true })
    .selectOption(db.zones[0].id);
  db.fail = true;
  await page.getByRole("button", { name: "บันทึกไมค์", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("ซ้ำ");
  await expect(page.getByLabel("ชื่อจุดติดตั้ง", { exact: true })).toHaveValue(
    "ไมค์ทดสอบ",
  );
  db.fail = false;
  await page.getByRole("button", { name: "บันทึกไมค์", exact: true }).click();
  await expect(row).toContainText("ป่าอนุรักษ์ทดสอบ");
  await row.getByRole("button", { name: "ลบไมค์" }).click();
  await page.getByLabel("รหัสผ่านของคุณ", { exact: true }).fill("Admin123!");
  await page.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await stationTab.click();
  await expect(row).toHaveCount(0);
});

test("zone editing preserves original on cancel and rejects crossing vertices", async ({
  page,
}) => {
  const db = await zoneBackend(page);
  await page.setViewportSize({ width: 400, height: 947 });
  await page.goto("/zones");
  await page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }).click();
  await page.getByText("แก้พิกัดจุดด้วยตัวเลข (4 จุด)", { exact: true }).click();
  await page.getByLabel("ลองจิจูดจุด 2", { exact: true }).fill("98.78");
  await page.getByLabel("ละติจูดจุด 2", { exact: true }).fill("18.14");
  await page.getByLabel("ละติจูดจุด 3", { exact: true }).fill("18.12");
  await expect(
    page.getByRole("button", { name: "จบการวาด", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/เส้นขอบเขตตัดกัน/)).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  expect(db.saves).toBe(0);
  await page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }).click();
  await page.getByRole("button", { name: "จบการวาด", exact: true }).click();
  await page.getByRole("button", { name: "บันทึกขอบเขต", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("บันทึกขอบเขตโซนแล้ว");
  expect(db.saves).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/zones-mobile.png",
    fullPage: true,
  });
});

test("map drawing supports add, select, undo, remove, drag and zone name labels", async ({
  page,
}) => {
  await zoneBackend(page);
  await page.goto("/zones");
  await expect(
    page.getByRole("button", { name: "ป่าอนุรักษ์ทดสอบ", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "วาดโซนใหม่", exact: true }).click();
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  for (const [x, y] of [
    [130, 140],
    [250, 140],
    [250, 280],
    [130, 280],
  ])
    await canvas.click({ position: { x, y } });
  await expect(
    page.getByRole("button", { name: "จุดขอบเขต 4", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "จุดขอบเขต 1", exact: true }).click();
  await page.getByRole("button", { name: "ลบจุดที่เลือก", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "จุดขอบเขต 4", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "ย้อนจุด", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "จบการวาด", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "ล้างทั้งหมด", exact: true }).click();
  for (const [x, y] of [
    [130, 140],
    [250, 140],
    [250, 280],
    [130, 280],
  ])
    await canvas.click({ position: { x, y } });
  await page.getByText("แก้พิกัดจุดด้วยตัวเลข (4 จุด)", { exact: true }).click();
  const before = await page
    .getByLabel("ลองจิจูดจุด 1", { exact: true })
    .inputValue();
  const marker = page.getByRole("button", { name: "จุดขอบเขต 1", exact: true });
  const box = await marker.boundingBox();
  if (!box) throw new Error("Missing vertex");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 25,
    box.y + box.height / 2 + 10,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByLabel("ลองจิจูดจุด 1", { exact: true })).not.toHaveValue(
    before,
  );
  await page.getByRole("button", { name: "จบการวาด", exact: true }).click();
  await page
    .getByRole("textbox", { name: "รหัสโซน", exact: true })
    .fill("ZN-NEW");
  await page
    .getByRole("textbox", { name: "ชื่อโซนป่า", exact: true })
    .fill("โซนวาดใหม่");
  await page.getByRole("button", { name: "บันทึกขอบเขต", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("บันทึกขอบเขตโซนแล้ว");
});

test("changed boundary warns about outside microphones without reassigning them", async ({
  page,
}) => {
  const db = await zoneBackend(page);
  await page.goto("/zones");
  await page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }).click();
  await page.getByText("แก้พิกัดจุดด้วยตัวเลข (4 จุด)", { exact: true }).click();
  const next = [
    [98.8, 18.15],
    [98.82, 18.15],
    [98.82, 18.17],
    [98.8, 18.17],
  ];
  for (let i = 0; i < next.length; i++) {
    await page
      .getByLabel(`ลองจิจูดจุด ${i + 1}`, { exact: true })
      .fill(String(next[i][0]));
    await page
      .getByLabel(`ละติจูดจุด ${i + 1}`, { exact: true })
      .fill(String(next[i][1]));
  }
  await page.getByRole("button", { name: "จบการวาด", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "บันทึกขอบเขต", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("ยืนยันขอบเขตนี้และคงสังกัดไมค์เดิม", { exact: true }).check();
  await page.getByRole("button", { name: "บันทึกขอบเขต", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("บันทึกขอบเขตโซนแล้ว");
  expect(db.stations[0].zone_id).toBe(db.zones[0].id);
});

test("invalid draft coordinates do not crash the map and vertex selection keeps keyboard focus", async ({
  page,
}) => {
  await zoneBackend(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/zones");
  await page.getByRole("button", { name: "เพิ่มไมค์", exact: true }).click();
  await page.getByLabel("ละติจูด", { exact: true }).fill("999");
  await page.getByLabel("ลองจิจูด", { exact: true }).fill("999");
  await page.getByRole("button", { name: "ดูแผนที่", exact: true }).click();
  await page.getByRole("tab", { name: /^โซนป่า/ }).click();
  await page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }).click();
  const vertex = page.getByRole("button", { name: "จุดขอบเขต 1", exact: true });
  await vertex.focus();
  await page.keyboard.press("Enter");
  await expect(vertex).toBeFocused();
  await expect(vertex).toHaveAttribute("aria-pressed", "true");
  await page.getByText("แก้พิกัดจุดด้วยตัวเลข (4 จุด)", { exact: true }).click();
  await page.getByLabel("ละติจูดจุด 1", { exact: true }).fill("999");
  await expect(
    page.getByRole("button", { name: "จบการวาด", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("microphone network failure keeps edits and repeated submission commits once without needing a reload", async ({
  page,
}) => {
  await zoneBackend(page);
  await page.goto("/zones");
  await page.getByRole("tab", { name: /^เสาไมค์/ }).click();
  await page.getByRole("button", { name: "แก้ไขไมค์", exact: true }).click();
  await page.getByLabel("ชื่อจุดติดตั้ง", { exact: true }).fill("ชื่อใหม่หลังบันทึก");
  let fail = true;
  let mutations = 0;
  await page.route("**/rest/v1/sensor_stations*", async (route) => {
    if (route.request().method() === "GET") return route.abort();
    if (fail) return route.abort();
    mutations++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return route.fulfill({
      json: {
        ...route.request().postDataJSON(),
        id: "22222222-2222-4222-8222-222222222201",
      },
    });
  });
  await page.getByRole("button", { name: "บันทึกไมค์", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("ชื่อจุดติดตั้ง", { exact: true })).toHaveValue(
    "ชื่อใหม่หลังบันทึก",
  );
  fail = false;
  await page
    .getByRole("button", { name: "บันทึกไมค์", exact: true })
    .evaluate((button) => {
      const form = (button as HTMLButtonElement).form!;
      form.requestSubmit();
      form.requestSubmit();
    });
  await expect(page.getByRole("status")).toContainText("บันทึกไมค์แล้ว");
  await expect(
    page.getByRole("article").filter({ hasText: "ST-TEST" }),
  ).toContainText("ชื่อใหม่หลังบันทึก");
  expect(mutations).toBe(1);
});

test("compact mobile directory switches tabs and jumps between map and form", async ({
  page,
}) => {
  await zoneBackend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zones");
  const map = page.getByRole("region", { name: "แผนที่โซนและเสาไมค์" });
  const form = page.getByRole("region", { name: "ฟอร์มจัดการโซนและเสาไมค์" });
  const canvas = page.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.height).toBeLessThanOrEqual(320);
  const zoneTab = page.getByRole("tab", { name: /^โซนป่า/ });
  const stationTab = page.getByRole("tab", { name: /^เสาไมค์/ });
  await expect(zoneTab).toHaveAttribute("aria-selected", "true");
  await zoneTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(stationTab).toBeFocused();
  await expect(stationTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }),
  ).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "ค้นหาเสาไมค์" });
  await search.fill("ไม่ตรง");
  await expect(page.getByText("ไม่พบรายการที่ตรงกับการค้นหา")).toBeVisible();
  await search.fill("st-test");
  await page.getByRole("button", { name: "แก้ไขไมค์", exact: true }).click();
  await expect(form).toBeFocused();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await page.getByRole("button", { name: "กลับไปที่แผนที่" }).click();
  await expect(map).toBeFocused();
  await page.getByRole("button", { name: "ไปที่ฟอร์ม" }).click();
  await expect(form).toBeFocused();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(stationTab).toBeFocused();
  await expect(search).toHaveValue("st-test");
  await zoneTab.click();
  await page.getByRole("button", { name: "แก้ไขขอบเขต", exact: true }).click();
  await page.getByRole("button", { name: "จบการวาด", exact: true }).click();
  await expect(form).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("zone deletion confirms its name, can cancel, and shows attached station blockers", async ({
  page,
}) => {
  const db = await zoneBackend(page);
  let calls = 0;
  await page.route("**/api/directory/delete", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({
      kind: "zone",
      targetId: db.zones[0].id,
      password: "Admin123!",
    });
    if (calls === 1)
      return route.fulfill({
        status: 409,
        json: {
          blocked: true,
          items: [
            {
              id: db.stations[0].id,
              kind: "station",
              name: "ST-TEST · ไมค์ทดสอบ",
            },
          ],
        },
      });
    db.zones = [];
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto("/zones");
  const row = page.getByRole("article").filter({ hasText: "ป่าอนุรักษ์ทดสอบ" });
  const trigger = row.getByRole("button", { name: "ลบโซน", exact: true });
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลบโซนป่า" });
  await trigger.click();
  await expect(dialog).toContainText("ป่าอนุรักษ์ทดสอบ");
  await expect(
    dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(calls).toBe(0);
  await trigger.click();
  const password = dialog.getByLabel("รหัสผ่านของคุณ");
  await password.fill("Admin123!");
  await dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("ถอดไมค์");
  await expect(dialog.getByRole("link", { name: /ST-TEST/ })).toBeVisible();
  await expect(password).toHaveValue("");
  expect(calls).toBe(1);
  await password.fill("Admin123!");
  await dialog.getByRole("button", { name: "ยืนยันลบ", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "ป่าอนุรักษ์ทดสอบ", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("ยังไม่มีโซนป่า", { exact: true })).toBeVisible();
});
