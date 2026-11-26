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

  let rejectedEvidence = true;
  await page.route(/\/storage\/v1\/object\/(?:public\/)?evidence-files\//, route => {
    if (route.request().method() === "POST") return route.fulfill({ json: { Key: "evidence-files/test" } });
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#b1c8bb"/></svg>',
    });
  });
  await page.route("**/rest/v1/rpc/save_field_inspection_evidence", route => {
    if (rejectedEvidence) return route.fulfill({ status: 409, json: { message: "Test evidence rejection" } });
    const input = route.request().postDataJSON();
    expect(input.p_report_id).toBe(report.id);
    expect(input.p_expected_updated_at).toBe(report.updated_at);
    expect(input.p_evidence).toHaveLength(1);
    const savedAt = new Date().toISOString();
    Object.assign(report, {
      field_outcome: input.p_outcome, field_notes: input.p_notes, report_evidence: input.p_evidence,
      submitted_at: savedAt, updated_at: savedAt,
    });
    return route.fulfill({ json: savedAt });
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
  const note = "ตรวจพบร่องรอยหน้างาน และแนบรูปจุดตรวจ";
  const notes = page.locator("textarea").first();
  await notes.fill(note);
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({
    name: "inspection.png", mimeType: "image/png", buffer: Buffer.from("inspection test"),
  });
  await submit.click();
  await expect(page.getByText(/บันทึกผลตรวจและหลักฐานไม่สำเร็จ/)).toBeVisible();
  await expect(notes).toHaveValue(note);
  expect(report.submitted_at).toBeNull();
  rejectedEvidence = false;
  await submit.click();
  await expect(page.getByText("ส่งผลแล้ว รอหลังบ้านตรวจ", { exact: true })).toBeVisible();
  await expect(submit).toHaveCount(0);
  expect(report.status).toBe("confirmed");

  await page.goto(backofficeUrl);
  await page.getByRole("button", { name: "อัปเดตผลตรวจ" }).click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  const thumbnail = page.getByRole("button", { name: "inspection.png" });
  const scrollArea = page.locator("[data-backoffice-scroll]");
  await thumbnail.scrollIntoViewIfNeeded();
  const originalScroll = await scrollArea.evaluate(element => element.scrollTop);
  await thumbnail.press("Enter");
  const viewer = page.getByRole("dialog", { name: "inspection.png" });
  await expect(viewer).toBeVisible();
  const desktopBounds = await viewer.boundingBox();
  expect(desktopBounds?.width).toBeCloseTo((page.viewportSize()?.width ?? 0) * 0.7, 0);
  expect(desktopBounds?.height).toBeCloseTo((page.viewportSize()?.height ?? 0) * 0.7, 0);
  await expect(scrollArea).toHaveCSS("overflow-y", "hidden");
  await page.mouse.move(desktopBounds!.x - 10, desktopBounds!.y + 100);
  await page.mouse.wheel(0, -300);
  await expect(page).toHaveURL(backofficeUrl);
  const image = viewer.getByRole("img", { name: "inspection.png" });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const zoom = viewer.getByRole("button", { name: "ซูมภาพหลักฐาน" });
  const zoomLevel = viewer.getByRole("combobox", { name: "ระดับซูมภาพ" });
  await expect(zoomLevel.locator("option:checked")).toHaveText("100%");
  await zoom.click({ position: { x: 350, y: 250 } });
  await expect(zoomLevel.locator("option:checked")).toHaveText("150%");
  await zoomLevel.selectOption({ label: "300%" });
  await expect(zoomLevel.locator("option:checked")).toHaveText("300%");
  const beforeDrag = await image.evaluate(element => getComputedStyle(element).transform);
  const frame = (await zoom.boundingBox())!;
  await page.mouse.move(frame.x + 380, frame.y + 300);
  await page.mouse.down();
  await page.mouse.move(frame.x + 520, frame.y + 370, { steps: 5 });
  await page.mouse.up();
  await expect(zoomLevel.locator("option:checked")).toHaveText("300%");
  expect(await image.evaluate(element => getComputedStyle(element).transform)).not.toBe(beforeDrag);
  await zoomLevel.selectOption({ label: "100%" });
  await expect(image).toHaveCSS("transform", "none");
  expect(await scrollArea.evaluate(element => element.scrollTop)).toBe(originalScroll);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(thumbnail).toBeFocused();
  await expect(scrollArea).toHaveCSS("overflow-y", "auto");
  expect(await scrollArea.evaluate(element => element.scrollTop)).toBe(originalScroll);

  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await thumbnail.click();
  const mobileBounds = await viewer.boundingBox();
  expect(mobileBounds?.width).toBeLessThanOrEqual(390);
  expect(mobileBounds?.height).toBeLessThanOrEqual(844);
  await zoomLevel.selectOption({ label: "200%" });
  await expect(zoomLevel.locator("option:checked")).toHaveText("200%");
  await viewer.getByRole("button", { name: "ปิดภาพ" }).click();
  if (desktopViewport) await page.setViewportSize(desktopViewport);
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

test("closed report keeps its location, timeline and saved dispatch readable across layouts", async ({ page }) => {
  await backend(page);
  const score = { classId: "chainsaw", label: "Chainsaw", score: 0.9 };
  const report = {
    id: crypto.randomUUID(), report_code: "RF-LAYOUT", status: "closed", risk_level: "red",
    lat: 18.8, lng: 98.9, created_at: new Date().toISOString(), assigned_to: admin.id, assignee: admin,
    dispatch_note: "Saved dispatch instruction", station_id: "station",
    sensor_stations: { id: "station", station_code: "ST-TEST", name: "Station", lat: 18.8, lng: 98.9, radius_meters: 350 },
    report_audio: [{ duration_seconds: 15, ai_classifications: [{ predicted_label: "chainsaw", confidence: 0.9,
      raw_response: { scores: [score], segments: [{ segmentIndex: 1, startSeconds: 5, endSeconds: 9, scores: [score] }] },
    }] }],
  };
  await page.route("**/rest/v1/reports*", route => route.fulfill({ json: [report] }));
  await page.route("**/tile.openstreetmap.org/**", route => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC", "base64"),
  }));
  await page.goto(`/reports/${report.id}`);
  const map = page.locator("section").filter({ hasText: "ST-TEST" }).filter({ has: page.locator("canvas") });
  const audio = page.locator("section").filter({ has: page.getByRole("heading", { name: /Audio Timeline|detection timeline/i }) });
  const dispatch = page.locator("section").filter({ hasText: "Saved dispatch instruction" });
  await expect(dispatch.getByText(admin.full_name)).toBeVisible();
  await expect(dispatch.getByRole("combobox")).toHaveCount(0);
  await expect(map.locator(".rf-report-marker")).toBeInViewport({ timeout: 15000 });
  await expect(map.locator(".rf-station-marker")).toBeInViewport({ timeout: 15000 });
  await audio.getByRole("button", { name: "เล่นเสียง" }).click();
  await audio.getByRole("button", { name: /0:05–0:09/ }).click();
  await expect(audio.getByText("0:05 / 0:15")).toBeVisible();
  await audio.getByRole("button", { name: "หยุดชั่วคราว" }).click();

  for (const language of ["th", "en"]) {
    if (language === "en") await page.getByRole("button", { name: "Switch to English" }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (language === "th" && width === 390) await page.getByRole("button", { name: "ก+", exact: true }).click();
      const mapBox = (await map.boundingBox())!;
      const audioBox = (await audio.boundingBox())!;
      const dispatchBox = (await dispatch.boundingBox())!;
      if (width === 1440) {
        expect(mapBox.y).toBeCloseTo(audioBox.y, 0);
        expect(mapBox.x).toBeGreaterThan(audioBox.x);
        const cards = dispatch.locator("..").locator(":scope > section");
        await expect(cards).toHaveCount(4);
        const gap = await cards.first().evaluate(el => parseFloat(getComputedStyle(el.parentElement!).rowGap));
        for (let index = 1; index < 4; index++) {
          const previous = (await cards.nth(index - 1).boundingBox())!;
          const current = (await cards.nth(index).boundingBox())!;
          expect(current.y - previous.y - previous.height).toBeCloseTo(gap, 0);
        }
      } else {
        expect(audioBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
      }
      expect(dispatchBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
      for (const panel of [map, audio, dispatch]) {
        expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      }
    }
  }
});
