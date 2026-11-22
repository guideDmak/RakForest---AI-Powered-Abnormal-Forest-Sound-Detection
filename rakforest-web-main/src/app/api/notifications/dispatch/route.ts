import { NextResponse } from "next/server";
import { createServiceRoleSupabase } from "@/lib/supabase/server";
import { getClassNameTh, RISK_LABELS_TH } from "@/lib/utils/risk";
import type { NotificationLog, ReportRecord, RiskLevel } from "@/types/database.types";

export const runtime = "nodejs";

const reportFields = "report_code, risk_level, created_at, description, lat, lng, sensor_stations(station_code,name), report_audio(ai_classifications(predicted_label,confidence,raw_response,processed_at))";
const formatTime = (value: string) => new Date(value).toLocaleString("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "medium",
});
const skip = () => NextResponse.json({ skipped: true });

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const automatic = body.mode === "automatic";
    const reportId = body.reportId ?? null;
    if ((automatic || reportId !== null) &&
        (typeof reportId !== "string" || !/^[0-9a-f-]{36}$/i.test(reportId))) {
      return NextResponse.json({ error: "รหัสอ้างอิงรายงานไม่ถูกต้อง" }, { status: 400 });
    }

    const supabase = createServiceRoleSupabase();
    let report: ReportRecord | null = null;
    if (reportId) {
      const result = await supabase.from("reports").select(reportFields).eq("id", reportId).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) return NextResponse.json({ error: "ไม่พบรายการรายงาน" }, { status: 404 });
      report = result.data as unknown as ReportRecord;
    }

    const analysis = report?.report_audio?.[0]?.ai_classifications?.[0];
    const riskLevel: RiskLevel = report?.risk_level ?? body.riskLevel ?? "red";
    if (automatic) {
      if (analysis?.raw_response?.source !== "http" ||
          (riskLevel !== "red" && riskLevel !== "yellow")) return skip();
      const rule = await supabase.from("notification_rules").select("channels").eq("risk_level", riskLevel).maybeSingle();
      if (rule.error) throw rule.error;
      if (!rule.data?.channels.includes("telegram")) return skip();
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = (!automatic && body.customChatId) || process.env.TELEGRAM_CHAT_ID;
    let recipients: string[] = chatId ? [chatId] : [];
    if (automatic) {
      const { data, error } = await supabase.rpc("field_alert_recipients", { p_report_id: reportId });
      if (error) throw error;
      recipients = (data as { chat_id: string }[]).map(({ chat_id }) => chat_id);
    }
    const reportCode = report?.report_code ?? body.reportCode ?? "RF-TEST";
    const predictedLabel = analysis?.predicted_label ?? (!report ? body.predictedLabel ?? "chainsaw" : null);
    const confidence = analysis?.confidence ?? body.confidence ?? 0.9;
    const station = report?.sensor_stations;
    const locationText = automatic && report ? (
      station ? `${station.station_code} · ${station.name}` : `${report.lat.toFixed(4)}, ${report.lng.toFixed(4)}`
    ) : body.locationText ?? "เขตอนุรักษ์ป่าแม่ริม";
    const note = automatic ? report?.description : body.note;
    const header = automatic
      ? (riskLevel === "red" ? "🚨 แจ้งเตือนด่วน" : "⚠️ แจ้งเตือนเฝ้าระวัง")
      : (report ? "📋 มอบหมายงานภาคสนาม" : "🧪 ทดสอบการแจ้งเตือน");
    const sentAt = new Date().toISOString();
    const message = [
      `${header} · RakForest`,
      `รหัสรายงาน: ${reportCode}`,
      `ระดับความเสี่ยง: ${RISK_LABELS_TH[riskLevel] ?? riskLevel}`,
      predictedLabel ? `เสียงที่ตรวจพบ: ${getClassNameTh(predictedLabel)} (ความมั่นใจ ${Math.round(Number(confidence) * 100)}%)` : "",
      `จุดตรวจ/พิกัด: ${locationText}`,
      report?.created_at ? `เวลาบันทึกเหตุในรายงาน: ${formatTime(report.created_at)}` : "",
      analysis?.processed_at ? `เวลาวิเคราะห์เสร็จ: ${formatTime(analysis.processed_at)}` : "",
      `เวลาส่งแจ้งเตือน: ${formatTime(sentAt)}`,
      automatic && riskLevel === "yellow" ? "กรุณาตรวจสอบสัญญาณเสียงซ้ำ" : "",
      note ? `รายละเอียด/คำสั่งการ: ${note}` : "",
    ].filter(Boolean).join("\n");

    const log: NotificationLog = {
      // The report ID reserves a single automatic attempt across simultaneous requests.
      id: automatic ? reportId : crypto.randomUUID(),
      report_id: reportId,
      channel: "telegram",
      recipient: automatic ? `Telegram · ภาคสนาม (${recipients.length})` : chatId ? `Telegram Chat (${chatId})` : "ศูนย์ปฏิบัติการ Telegram",
      message,
      status: "pending",
      error_message: null,
      sent_at: sentAt,
    };
    if (automatic) {
      const { error } = await supabase.from("notifications_log").insert(log);
      if (error?.code === "23505") return skip();
      if (error) throw error;
    }

    log.status = "failed";
    if (botToken && recipients.length > 0) {
      const results = await Promise.all(recipients.map(async (recipient) => {
        try {
          const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: recipient, text: message }),
            signal: AbortSignal.timeout(10000),
          });
          const result = await response.json().catch(() => null);
          return response.ok && result?.ok === true;
        } catch {
          return false;
        }
      }));
      const delivered = results.filter(Boolean).length;
      if (delivered === recipients.length) log.status = "sent";
      else log.error_message = `Telegram ส่งสำเร็จ ${delivered} จาก ${recipients.length} ปลายทาง`;
    } else {
      log.error_message = automatic && recipients.length === 0
        ? "ไม่พบเจ้าหน้าที่ในพื้นที่ที่เชื่อมต่อ Telegram"
        : "ยังไม่ได้ตั้งค่า Telegram";
    }

    const stored = automatic
      ? await supabase.from("notifications_log").update({ status: log.status, error_message: log.error_message }).eq("id", log.id)
      : await supabase.from("notifications_log").insert(log);
    if (stored.error) console.error("Notification log persistence failed", stored.error.code);

    return NextResponse.json({ ok: log.status === "sent", log, error: log.error_message });
  } catch {
    return NextResponse.json({ ok: false, error: "ส่งการแจ้งเตือนไม่สำเร็จ" }, { status: 500 });
  }
}
