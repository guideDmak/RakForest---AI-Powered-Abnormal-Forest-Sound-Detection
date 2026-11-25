import { expect, test } from "@playwright/test";
import { admin, backend } from "./accounts-fixture";

test("assignment feedback distinguishes a saved task from a failed Telegram alert", async ({ page }) => {
  const ranger = {
    ...admin,
    id: crypto.randomUUID(),
    employee_code: "TEST-RANGER",
    role: "field_ranger" as const,
  };
  await backend(page, [admin, ranger]);
  const report = {
    id: crypto.randomUUID(), report_code: "RF-ACTIONS", description: "Test incident",
    lat: 18, lng: 98, risk_level: "green", status: "pending", created_at: new Date().toISOString(),
  };
  let rejectDispatch = false;
  await page.route("**/rest/v1/reports*", (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: [report] });
    return rejectDispatch
      ? route.fulfill({ status: 400, json: { message: "Rejected" } })
      : route.fulfill({ json: { id: report.id } });
  });
  let finishTelegram!: () => void;
  const telegramResponse = new Promise<void>((resolve) => { finishTelegram = resolve; });
  await page.route("**/api/notifications/dispatch", async (route) => {
    await telegramResponse;
    await route.fulfill({ json: { log: { id: crypto.randomUUID(), status: "failed" } } });
  });

  await page.goto(`/reports/${report.report_code}`);
  const dispatch = page.locator("section").filter({ has: page.getByRole("heading", { name: /มอบหมายชุดปฏิบัติการภาคสนาม/ }) });
  try {
    await dispatch.getByRole("button", { name: /มอบหมายงานภาคสนาม/ }).click();
    await expect(dispatch.getByRole("status")).toHaveText("กำลังบันทึกการมอบหมายงาน…");
  } finally {
    finishTelegram();
  }
  await expect(dispatch.getByRole("status")).toHaveText("บันทึกการมอบหมายงานแล้ว แต่ส่ง Telegram ไม่สำเร็จ");

  await dispatch.getByRole("checkbox", { name: /Telegram/ }).uncheck();
  await dispatch.getByRole("button", { name: /อัปเดตคำสั่งการ/ }).click();
  await expect(dispatch.getByRole("status")).toHaveText("บันทึกการมอบหมายงานภาคสนามแล้ว");

  rejectDispatch = true;
  await dispatch.getByRole("button", { name: /อัปเดตคำสั่งการ/ }).click();
  await expect(dispatch.getByRole("alert")).toContainText("มอบหมายงานไม่สำเร็จ");
});

test("field report starts evidence uploads and audio analysis before Storage finishes", async ({ page }) => {
  await backend(page);
  const started: string[] = [];
  const evidencePaths = new Set<string>();
  let storedReport: Record<string, unknown> | undefined;
  let finishUploads!: () => void;
  const uploads = new Promise<void>((resolve) => { finishUploads = resolve; });
  await page.route("**/storage/v1/object/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "POST") return route.abort();
    if (path.includes("/evidence-files/")) {
      started.push("evidence");
      evidencePaths.add(path);
    } else {
      started.push("audio");
    }
    await uploads;
    await route.fulfill({ json: { Key: path } });
  });
  await page.route("**/api/classify-audio", (route) => {
    started.push("analysis");
    return route.fulfill({ status: 503, json: { error: "Test model unavailable" } });
  });
  await page.route("**/rest/v1/reports*", (route) => {
    if (route.request().method() === "POST") storedReport = route.request().postDataJSON();
    return route.fulfill({ json: storedReport ? [storedReport] : [] });
  });

  await page.goto("/report/new");
  await page.locator('input[type="file"][accept^="audio/"]').setInputFiles({
    name: "test.wav", mimeType: "audio/wav", buffer: Buffer.from("test audio"),
  });
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles([
    { name: "evidence.png", mimeType: "image/png", buffer: Buffer.from("first") },
    { name: "evidence.png", mimeType: "image/png", buffer: Buffer.from("second") },
  ]);
  try {
    await page.getByRole("button", { name: /ส่งรายงานและวิเคราะห์เสียง/ }).click();
    await expect(page.getByText("กำลังอัปโหลดไฟล์และวิเคราะห์เสียง…", { exact: true })).toBeVisible();
    await expect.poll(() => [...started].sort()).toEqual(["analysis", "audio", "evidence", "evidence"]);
    expect(evidencePaths.size).toBe(2);
    expect(storedReport).toBeUndefined();
  } finally {
    finishUploads();
  }
  await expect(page).toHaveURL(/\/field-reports\/[^/]+$/);
  expect(storedReport?.risk_level).toBe("green");
});

test("a confirmed incident stays active until the field result is submitted, reviewed and closed", async ({ page }) => {
  await backend(page);
  const initialTime = new Date(Date.now() - 1000).toISOString();
  const report = {
    id: crypto.randomUUID(), report_code: "RF-WORKFLOW", description: "Test incident",
    lat: 18, lng: 98, risk_level: "green", status: "pending", created_at: initialTime, updated_at: initialTime,
    acknowledged_at: null, submitted_at: null, reviewed_at: null, field_outcome: null,
  };
  await page.route("**/rest/v1/reports*", (route) => {
    if (route.request().method() !== "PATCH") return route.fulfill({ json: [report] });
    const filters = new URL(route.request().url()).searchParams;
    if (filters.get("status") !== `eq.${report.status}` || filters.get("updated_at") !== `eq.${report.updated_at}`) {
      return route.fulfill({ status: 406, json: { message: "Stale report" } });
    }
    Object.assign(report, route.request().postDataJSON());
    return route.fulfill({ json: { id: report.id, updated_at: report.updated_at } });
  });

  const backofficeUrl = `/reports/${report.id}`;
  const fieldList = "/field-reports";
  const confirmAction = () => page.getByRole("button", { name: "ใช่, ยืนยันการบันทึกผลนี้" }).click();
  const closeButton = page.getByRole("button", { name: "ปิดงาน", exact: true });

  await page.goto(backofficeUrl);
  await expect(closeButton).toBeDisabled();
  await page.getByRole("button", { name: "ยืนยันเหตุจริง", exact: true }).click();
  await confirmAction();
  await expect(page.getByText("บันทึกผลยืนยันเหตุจริงแล้ว", { exact: true })).toBeVisible();
  expect(report.status).toBe("confirmed");

  await page.goto(fieldList);
  const fieldTask = page.getByRole("article").filter({ hasText: report.report_code });
  await expect(fieldTask).toBeVisible();
  await expect(fieldTask.getByRole("link", { name: "ส่งผลตรวจ", exact: true })).toHaveCount(0);
  await fieldTask.getByRole("button", { name: "รับทราบงาน", exact: true }).click();
  await fieldTask.getByRole("link", { name: "ส่งผลตรวจ", exact: true }).click();
  const submit = page.getByRole("button", { name: "ส่งผลการตรวจสอบพื้นที่ให้ศูนย์สั่งการ", exact: true });
  await submit.click();
  await expect(page.getByText("ส่งผลแล้ว รอหลังบ้านตรวจ", { exact: true })).toBeVisible();
  await expect(submit).toHaveCount(0);
  expect(report.status).toBe("confirmed");

  await page.goto(backofficeUrl);
  await expect(closeButton).toBeDisabled();
  await page.getByRole("button", { name: "ตรวจผลภาคสนามแล้ว", exact: true }).click();
  await confirmAction();
  await expect(closeButton).toBeEnabled();

  await page.goto(fieldList);
  await expect(fieldTask.getByText("ตรวจผลแล้ว รอปิดงาน", { exact: true })).toBeVisible();
  await page.goto(backofficeUrl);
  await closeButton.click();
  await confirmAction();
  await expect(page.getByRole("status").filter({ hasText: /^ปิดงานแล้ว$/ })).toBeVisible();
  await expect(closeButton).toBeDisabled();
  expect(report.status).toBe("closed");

  await page.goto(fieldList);
  const activeTab = page.getByRole("button", { name: /ภารกิจที่ต้องดำเนินการ/ });
  await expect(activeTab).toContainText("0");
  await expect(fieldTask).toHaveCount(0);
  await page.getByRole("button", { name: /ปิดงานแล้ว/ }).click();
  await expect(fieldTask).toBeVisible();
});
