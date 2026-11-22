import { expect, test } from "@playwright/test";
import { admin, backend } from "./accounts-fixture";

test("language changes in place and persists across navigation and reload", async ({
  page,
}) => {
  await backend(page);
  await page.goto("/login");
  const identifier = page.locator("#login-identifier");
  await identifier.fill("ranger@example.test");
  await page.getByRole("button", { name: "Switch to English" }).press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Staff sign-in" }),
  ).toBeVisible();
  await expect(identifier).toHaveValue("ranger@example.test");
  await page.goto("/accounts");
  await expect(
    page.getByRole("heading", { name: "Staff management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: admin.full_name, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Account settings" }).first().click();
  await expect(
    page.getByRole("dialog").getByText("Change password", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "เปลี่ยนเป็นภาษาไทย" }).click();
  await expect(
    page.getByRole("heading", { name: "จัดการเจ้าหน้าที่" }),
  ).toBeVisible();
});

test("field and backoffice screens render in English on a phone", async ({
  page,
  context,
  baseURL,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addCookies([
    { name: "rakforest-language", value: "en", url: baseURL! },
  ]);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const screens = [
    ["/dashboard", "Forest operations overview"],
    ["/reports", "Incident reports and AI audio analysis"],
    ["/zones", "Forest zones and stations"],
    ["/map", "Forest zones and acoustic station map"],
    ["/accounts/new", "Register staff"],
    ["/settings/alerts", "Automatic alert settings"],
    ["/home", "Welcome, " + admin.full_name],
    ["/field-map", "Patrol zone and station map"],
    ["/field-reports", "Field assignments and report history"],
    ["/report/new", "Record audio and report a field incident"],
    ["/profile", "Staff profile and notifications"],
    ["/verify", "Awaiting administrator approval"],
  ];
  for (const [url, heading] of screens) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "เปลี่ยนเป็นภาษาไทย" }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("report and zone details keep recorded names and notes when translated", async ({
  page,
  context,
  baseURL,
}) => {
  await backend(page);
  await context.addCookies([
    { name: "rakforest-language", value: "en", url: baseURL! },
  ]);
  const zone = {
    id: "zone-test",
    zone_code: "ZN-TEST",
    name: "ป่าชุมชนทดสอบ",
    current_risk_level: "green",
    polygon_coords: [
      [98, 18],
      [98.1, 18],
      [98.1, 18.1],
    ],
  };
  const report = {
    id: "report-test",
    report_code: "RF-TEST",
    description: "เจ้าหน้าที่ตรวจพบร่องรอย",
    status: "acknowledged",
    risk_level: "green",
    source_type: "field_patrol",
    lat: 18,
    lng: 98,
    zone_id: zone.id,
    forest_zones: zone,
    created_at: "2026-01-01T00:00:00Z",
    report_audio: [],
    report_evidence: [],
  };
  await page.route("**/rest/v1/forest_zones*", (r) =>
    r.fulfill({ json: [zone] }),
  );
  await page.route("**/rest/v1/reports*", (r) => r.fulfill({ json: [report] }));
  await page.goto("/zones/ZN-TEST");
  await expect(page.getByRole("heading", { name: zone.name })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to zones and stations" }),
  ).toBeVisible();
  await page.goto("/reports/RF-TEST");
  await expect(
    page.getByRole("heading", { name: report.report_code }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to reports" }),
  ).toBeVisible();
  await page.goto("/field-reports/RF-TEST");
  await expect(
    page.getByRole("heading", { name: "Field inspection report" }),
  ).toBeVisible();
  await expect(
    page.getByText(report.description, { exact: true }),
  ).toBeVisible();
});
