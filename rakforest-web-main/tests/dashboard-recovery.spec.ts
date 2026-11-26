import { expect, test } from "@playwright/test";
import { backend } from "./accounts-fixture";

test("dashboard reports database failures, retries, and reloads after reconnecting", async ({ page }) => {
  await backend(page);
  let failure: "station" | "report" | null = "station";
  let stationReads = 0;
  await page.route("**/rest/v1/sensor_stations*", route => {
    stationReads++;
    return failure === "station"
      ? route.fulfill({ status: 503, json: { message: "Service unavailable" } })
      : route.fulfill({ json: [] });
  });
  await page.route("**/rest/v1/reports*", route => failure === "report"
    ? route.fulfill({ status: 503, json: { message: "Service unavailable" } })
    : route.fulfill({ json: [] }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/dashboard");
  const alert = page.getByRole("alert").filter({ hasText: "โหลดข้อมูลแดชบอร์ดไม่สำเร็จ" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("heading", { name: /ศูนย์ปฏิบัติการเฝ้าระวังเสียงป่าไม้/ })).toHaveCount(0);
  failure = null;
  await alert.getByRole("button", { name: "ลองอีกครั้ง" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /ศูนย์ปฏิบัติการเฝ้าระวังเสียงป่าไม้/ })).toBeVisible();
  failure = "report";
  await page.evaluate(() => window.dispatchEvent(new Event("rakforest-data-updated")));
  await expect(alert).toBeVisible();
  failure = null;
  const readsBeforeReconnect = stationReads;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(alert).toHaveCount(0);
  await expect.poll(() => stationReads).toBeGreaterThan(readsBeforeReconnect);
  expect(errors).toEqual([]);
});
