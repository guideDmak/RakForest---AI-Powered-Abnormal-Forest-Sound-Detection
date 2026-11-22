"use client";
import { useLanguage, useNotice } from "@/lib/i18n/language";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { rakforestRepo } from "@/lib/supabase/repository";
import { RiskBadge } from "@/components/reports/RiskBadge";
import type {
  NotificationLog,
  NotificationRule,
  RiskLevel,
} from "@/types/database.types";

const ALERT_DESCRIPTIONS: Record<RiskLevel, string> = {
  red: "ส่งแจ้งเตือนด่วนทันทีเมื่อโมเดลจริงวิเคราะห์เสร็จและบันทึกผลแล้ว",
  yellow: "ส่งแจ้งเตือนเฝ้าระวังทันทีเมื่อบันทึกผลโมเดลจริง พร้อมขอให้ตรวจสอบสัญญาณซ้ำ",
  green: "เก็บผลไว้ในประวัติรายงาน",
};

const DEFAULT_FIELD_RADIUS_METERS = 1000;
const MAX_FIELD_RADIUS_METERS = 100_000;

const CHANNELS = [
  { id: "telegram", label: "Telegram Bot API (ช่องทางหลัก)" },
  { id: "sms", label: "SMS แจ้งเตือนด่วน" },
  { id: "email", label: "อีเมลหน่วยงาน" },
  { id: "push", label: "Web Push Notification" },
] as const;

export default function BackofficeAlertSettingsPage() {
  const { t, language } = useLanguage();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [savingRule, setSavingRule] = useState<RiskLevel | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [feedback, setFeedback] = useNotice();
  const [draftNote, setTestNote] = useState<string | null>(null);
  const testNote = draftNote ?? t("ทดสอบการส่งสัญญาณแจ้งเตือนจากศูนย์สั่งการ RakForest เข้ากลุ่มปฏิบัติการ Telegram");

  const loadData = useCallback(async () => {
    const [r, l] = await Promise.all([
      rakforestRepo.getNotificationRules(),
      rakforestRepo.getNotificationLogs(),
    ]);
    setRules(r);
    setLogs(l);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveRule(rule: NotificationRule, changes: Pick<Partial<NotificationRule>, "channels" | "field_radius_meters">) {
    setSavingRule(rule.risk_level);
    setFeedback("");
    try {
      setRules(await rakforestRepo.updateNotificationRule({ risk_level: rule.risk_level, ...changes }));
      setFeedback('บันทึกการตั้งค่าช่องทางแจ้งเตือนระดับ "{risk}" แล้ว', { risk: rule.risk_level });
    } catch {
      setFeedback("บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ");
    } finally {
      setSavingRule(null);
    }
  }

  function toggleTelegram(rule: NotificationRule) {
    const channels = rule.channels.includes("telegram")
      ? rule.channels.filter((channel) => channel !== "telegram")
      : [...rule.channels, "telegram"];
    return saveRule(rule, { channels });
  }

  async function sendLiveTelegramTest() {
    setTestBusy(true);
    setFeedback("");
    try {
      const log = await rakforestRepo.dispatchTelegramNotification({
        reportCode: "RF-TG-TEST",
        riskLevel: "red",
        predictedLabel: "chainsaw",
        confidence: 0.92,
        locationText: "เสาไมค์ ST-01 (ห้วยแม่ริม A • 18.1234, 98.7654)",
        note: testNote,
      });
      await loadData();
      setFeedback(
        log?.status === "sent"
          ? "ส่งข้อความแจ้งเตือนเข้า Telegram สำเร็จแล้ว! กรุณาตรวจสอบในแอป Telegram ของคุณ"
          : "บันทึกประวัติแล้ว ({result})",
        { result: log?.error_message || t("ตรวจสอบสถานะด้านล่าง") },
      );
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#14241B]">{t("ตั้งค่าการแจ้งเตือนอัตโนมัติ (Telegram Bot API & Multi-Channel Alerts)")}</h1>
        <p className="text-xs text-[#526358]">{t("กำหนดเงื่อนไขการส่งข้อความแจ้งเตือนตามระดับความเสี่ยงของเสียงที่โมเดล AI ตรวจพบ และทดสอบส่งข้อความเข้า Telegram จริง")}</p>
      </div>

      {feedback && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-700" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Rules Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {rules.map((rule) => (
          <section
            key={rule.risk_level}
            className="rounded-lg border border-[#D4DCD5] bg-white p-4 space-y-3 flex flex-col justify-between"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <RiskBadge level={rule.risk_level} size="md" />
                <span className="font-mono-code text-xs text-[#526358]">
                  Rule: {rule.risk_level.toUpperCase()}
                </span>
              </div>
              <p className="text-xs text-[#435449] leading-relaxed">
                {t(ALERT_DESCRIPTIONS[rule.risk_level])}
              </p>
            </div>

            <fieldset className="space-y-2 border-t border-[#E4ECE6] pt-3 text-xs">
              <legend className="pr-2 font-semibold">{t("ช่องทางแจ้งเตือน")}</legend>
              {CHANNELS.map(({ id, label }) => {
                const isTelegram = id === "telegram";
                const canToggle = isTelegram && rule.risk_level !== "green";
                return (
                  <label key={id} className="flex min-h-7 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={canToggle && rule.channels.includes(id)}
                      disabled={!canToggle || savingRule !== null}
                      onChange={() => void toggleTelegram(rule)}
                    />
                    <span>{t(label)}</span>
                    {!canToggle && (
                      <span className="ml-auto text-[#526358]">
                        {t(isTelegram ? "เก็บในประวัติเท่านั้น" : "ยังไม่เชื่อมต่อ")}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
            {rule.risk_level !== "green" && (
              <form
                className="space-y-2 border-t border-[#E4ECE6] pt-3 text-xs"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = new FormData(event.currentTarget).get("radius");
                  const meters = Number(value);
                  if (value && Number.isInteger(meters) && meters >= 0 && meters <= MAX_FIELD_RADIUS_METERS) {
                    void saveRule(rule, { field_radius_meters: meters });
                  }
                }}
              >
                <label className="block font-semibold">
                  {t("รัศมีแจ้งเตือนเจ้าหน้าที่ภาคสนาม (เมตร)")}
                  <input
                    key={rule.field_radius_meters}
                    className="mt-1 block min-h-10 w-full rounded-md border border-[#B8C7BC] px-3"
                    type="number"
                    name="radius"
                    min={0}
                    max={MAX_FIELD_RADIUS_METERS}
                    step={1}
                    required
                    defaultValue={rule.field_radius_meters ?? DEFAULT_FIELD_RADIUS_METERS}
                    disabled={savingRule !== null}
                    aria-describedby={`radius-help-${rule.risk_level}`}
                  />
                </label>
                <p id={`radius-help-${rule.risk_level}`} className="text-[#526358]">
                  {t("ส่งถึงเจ้าหน้าที่ประจำโซนเกิดเหตุและโซนใกล้จุดเกิดเหตุ วัดถึงขอบเขตโซน ค่าเริ่มต้น 1,000 ม. ตั้ง 0 เพื่อใช้เฉพาะโซนเกิดเหตุ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={savingRule !== null} className="min-h-10 rounded-md bg-[#1B4332] px-3 font-semibold text-white disabled:opacity-50">
                    {t("บันทึกรัศมี")}
                  </button>
                  <button type="button" disabled={savingRule !== null} onClick={(event) => {
                    event.currentTarget.form?.reset();
                    void saveRule(rule, { field_radius_meters: DEFAULT_FIELD_RADIUS_METERS });
                  }} className="min-h-10 rounded-md border border-[#B8C7BC] px-3 font-semibold text-[#1B4332] disabled:opacity-50">
                    {t("คืนค่าเริ่มต้น")}
                  </button>
                </div>
              </form>
            )}
          </section>
        ))}
      </div>

      {/* Live Telegram Test Card */}
      <section className="rounded-lg border border-[#B8C7BC] bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4ECE6] pb-3">
          <div>
            <h2 className="text-base font-bold text-[#14241B]">{t("ทดสอบส่งข้อความแจ้งเตือนเข้า Telegram จริง (Live Telegram Dispatch)")}</h2>
            <p className="text-xs text-[#526358]">{t("เชื่อมต่อกับ TELEGRAM_BOT_TOKEN และ TELEGRAM_CHAT_ID (1750820064) ที่ตั้งค่าไว้ในระบบ")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-9">
            <label className="block text-xs font-semibold text-[#14241B] mb-1">{t("ข้อความคำสั่งการทดสอบที่จะส่งเข้า Telegram")}</label>
            <input
              type="text"
              value={testNote}
              onChange={(e) => setTestNote(e.target.value)}
              className="w-full rounded-lg border border-[#B8C7BC] px-3.5 py-2 text-xs sm:text-sm"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="button"
              disabled={testBusy}
              onClick={sendLiveTelegramTest}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#1B4332] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#2D6A4F] disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span>{testBusy ? t("กำลังส่งเข้า Telegram…") : t("ส่งข้อความทดสอบ")}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Notification Logs History */}
      <section className="rounded-lg border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-3">
        <h2 className="text-base font-bold text-[#14241B]">{t("ประวัติการส่งข้อความแจ้งเตือนย้อนหลัง")}</h2>
        <div className="space-y-2.5">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-lg border border-[#E2E8E3] bg-[#F8FAF8] p-3 text-xs space-y-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono-code font-bold text-[#1B4332] uppercase">
                  [{log.channel}] {log.recipient}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 font-semibold ${
                      log.status === "sent"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-red-100 text-red-900"
                    }`}
                  >
                    {log.status === "sent" ? t("ส่งสำเร็จ") : log.status === "pending" ? t("รอยืนยันผลการส่ง") : t("ล้มเหลว")}
                  </span>
                  <span className="text-[#526358]">
                    {new Date(log.sent_at).toLocaleString(language === "en" ? "en-GB" : "th-TH", {
                      timeZone: "Asia/Bangkok",
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </span>
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[#14241B] pt-1">
                {log.message}
              </pre>
              {log.error_message && (
                <p className="text-[11px] text-amber-800">{log.error_message}</p>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
