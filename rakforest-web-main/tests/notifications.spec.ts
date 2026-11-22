import { expect, test } from "@playwright/test";
import { POST } from "../src/app/api/notifications/dispatch/route";
import { backend } from "./accounts-fixture";
import type { NotificationLog, RiskLevel } from "../src/types/database.types";

test("sends automatic Telegram only for saved, enabled real-model results", async () => {
  const originalFetch = globalThis.fetch;
  const savedToken = process.env.TELEGRAM_BOT_TOKEN;
  const savedChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  const logs = new Map<string, NotificationLog>();
  const messages: string[] = [];
  const recipients: string[] = [];
  let fieldChatIds = ["1234", "-5678"];
  let risk: RiskLevel = "red";
  let source: "http" | "fallback" | null = "http";
  let failTelegram = false;
  let enabled = true;
  const processedAt = "2026-11-22T10:04:00Z";
  const detectedAt = "2026-11-22T10:00:00Z";
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.hostname === "api.telegram.org") {
      const sent = JSON.parse(String(init?.body));
      recipients.push(sent.chat_id);
      messages.push(sent.text);
      return Response.json({ ok: !failTelegram }, { status: failTelegram ? 502 : 200 });
    }
    const table = url.pathname.split("/").at(-1);
    if (table === "reports") return Response.json({
      report_code: "RF-TEST", risk_level: risk, created_at: detectedAt, description: "Test notes",
      lat: 18, lng: 98, sensor_stations: { station_code: "ST-01", name: "Test station" },
      report_audio: source ? [{ ai_classifications: [{
        predicted_label: "chainsaw", confidence: 0.92,
        raw_response: { source }, processed_at: processedAt,
      }] }] : [],
    });
    if (table === "field_alert_recipients") return Response.json(fieldChatIds.map(chat_id => ({ chat_id })));
    if (table === "notification_rules") return Response.json({ channels: enabled ? ["telegram"] : [] });
    if (table === "notifications_log" && init?.method === "POST") {
      const log = JSON.parse(String(init.body)) as NotificationLog;
      if (logs.has(log.id)) return Response.json({ code: "23505" }, { status: 409 });
      logs.set(log.id, log);
      return new Response(null, { status: 201 });
    }
    if (table === "notifications_log" && init?.method === "PATCH") {
      const id = url.searchParams.get("id")?.slice(3);
      const log = id ? logs.get(id) : undefined;
      if (!log) return new Response(null, { status: 404 });
      Object.assign(log, JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected mock request");
  };

  const send = async (reportId: string | null, mode?: "automatic") => {
    const response = await POST(new Request("http://localhost/api/notifications/dispatch", {
      method: "POST",
      body: JSON.stringify({ reportId, mode }),
    }));
    expect(response.status).toBe(200);
    return response.json();
  };

  try {
    const redId = crypto.randomUUID();
    await Promise.all([send(redId, "automatic"), send(redId, "automatic")]);
    expect(messages).toHaveLength(2);
    expect(recipients).toEqual(fieldChatIds);
    expect(messages[0]).toContain("แจ้งเตือนด่วน");
    expect(messages[0]).toContain("ST-01");
    expect(messages[0]).toMatch(/เวลาบันทึกเหตุในรายงาน: .+17:00:00/);
    expect(messages[0]).toMatch(/เวลาวิเคราะห์เสร็จ: .+17:04:00/);
    expect(messages[0]).toContain("เวลาส่งแจ้งเตือน");
    expect(logs.get(redId)?.status).toBe("sent");
    risk = "yellow";
    expect((await send(crypto.randomUUID(), "automatic")).ok).toBe(true);
    expect(messages[2]).toContain("แจ้งเตือนเฝ้าระวัง");
    expect(messages[2]).toContain("กรุณาตรวจสอบสัญญาณเสียงซ้ำ");
    risk = "green";
    expect((await send(crypto.randomUUID(), "automatic")).skipped).toBe(true);
    risk = "red";
    source = "fallback";
    expect((await send(crypto.randomUUID(), "automatic")).skipped).toBe(true);
    source = null;
    expect((await send(crypto.randomUUID(), "automatic")).skipped).toBe(true);
    source = "http";
    enabled = false;
    expect((await send(crypto.randomUUID(), "automatic")).skipped).toBe(true);
    expect(messages).toHaveLength(4);
    enabled = true;
    fieldChatIds = [];
    expect((await send(crypto.randomUUID(), "automatic")).log.status).toBe("failed");
    expect(messages).toHaveLength(4);
    fieldChatIds = ["1234"];
    failTelegram = true;
    const failedId = crypto.randomUUID();
    expect((await send(failedId, "automatic")).ok).toBe(false);
    expect(logs.get(failedId)?.status).toBe("failed");
    failTelegram = false;
    expect((await send(redId)).ok).toBe(true);
    expect((await send(null)).ok).toBe(true);
    expect(messages[5]).toContain("มอบหมายงานภาคสนาม");
    expect(messages[6]).toContain("ทดสอบการแจ้งเตือน");
    expect(recipients.slice(-2)).toEqual(["test-chat", "test-chat"]);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedToken;
    if (savedChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = savedChat;
  }
});

test.use({ timezoneId: "America/Los_Angeles" });

test("history uses Bangkok time and reopening a simulated report never sends a message", async ({ page }) => {
  await backend(page);
  const log = {
    id: crypto.randomUUID(), sent_at: "2026-11-22T10:05:04Z",
    channel: "telegram", recipient: "Test channel", message: "Test log", status: "sent",
  };
  await page.route("**/rest/v1/notifications_log*", route => route.fulfill({ json: [log] }));
  const rules = ["red", "yellow", "green"].map(risk_level => ({
    risk_level, channels: ["telegram", "sms", "email", "push"], field_radius_meters: 1000,
  }));
  await page.route("**/rest/v1/notification_rules*", route => {
    const request = route.request();
    if (request.method() !== "PATCH") return route.fulfill({ json: rules });
    const risk = new URL(request.url()).searchParams.get("risk_level")?.slice(3);
    const rule = rules.find(entry => entry.risk_level === risk);
    if (!rule) return route.fulfill({ status: 404 });
    Object.assign(rule, request.postDataJSON());
    return route.fulfill({ json: rule });
  });
  let requests = 0;
  await page.route("**/api/notifications/dispatch", async route => {
    requests++;
    await route.abort();
  });
  await page.goto("/settings/alerts");
  await expect(page.getByText(/17:05:04/)).toBeVisible();
  const channelGroups = page.getByRole("group", { name: "ช่องทางแจ้งเตือน" });
  await expect(channelGroups).toHaveCount(3);
  await expect(channelGroups.nth(0).getByRole("checkbox", { name: /Telegram/ })).toBeChecked();
  await expect(channelGroups.nth(1).getByRole("checkbox", { name: /Telegram/ })).toBeEnabled();
  await expect(channelGroups.nth(2).getByRole("checkbox", { name: /Telegram/ })).toBeDisabled();
  for (const channel of ["SMS", "อีเมล", "Web Push"]) {
    const controls = channelGroups.nth(0).getByRole("checkbox", { name: new RegExp(channel) });
    await expect(controls).toBeDisabled();
    await expect(controls).not.toBeChecked();
  }
  const radiusInputs = page.getByRole("spinbutton");
  await expect(radiusInputs).toHaveCount(2);
  await expect(radiusInputs.first()).toHaveValue("1000");
  await radiusInputs.first().fill("2500");
  await page.getByRole("button", { name: "บันทึกรัศมี" }).first().click();
  await expect.poll(() => rules[0].field_radius_meters).toBe(2500);
  await page.reload();
  await expect(page.getByText(/17:05:04/)).toBeVisible();
  await expect(radiusInputs.first()).toHaveValue("2500");
  await expect(radiusInputs.last()).toHaveValue("1000");
  await page.getByRole("button", { name: "คืนค่าเริ่มต้น" }).first().click();
  await expect(radiusInputs.first()).toHaveValue("1000");
  const report = {
    id: crypto.randomUUID(), report_code: "RF-SIMULATED", created_at: "2026-11-22T10:00:00Z",
    description: "Demo report", lat: 18, lng: 98, source_type: "field_patrol",
    risk_level: "red", status: "acknowledged", report_evidence: [],
    report_audio: [{ file_url: "", ai_classifications: [{
      predicted_label: "chainsaw", confidence: 0.92, model_version: "demo",
      raw_response: { source: "fallback", scores: [] },
    }] }],
  };
  await page.route("**/rest/v1/reports*", route => route.fulfill({ json: [report] }));
  await page.goto("/reports/RF-SIMULATED");
  await expect(page.getByText("ผลจำลองสำหรับเดโม", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("ผลจำลองสำหรับเดโม", { exact: true })).toBeVisible();
  await page.goto("/field-reports/RF-SIMULATED");
  await expect(page.getByText("ผลจำลองสำหรับเดโม", { exact: true })).toBeVisible();
  expect(requests).toBe(0);
});