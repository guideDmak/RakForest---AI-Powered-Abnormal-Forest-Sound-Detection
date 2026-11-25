"use client";
import { useLanguage } from "@/lib/i18n/language";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Mic, Radio, Send } from "lucide-react";
import { rakforestRepo } from "@/lib/supabase/repository";
import { getClassNameTh } from "@/lib/utils/risk";
import { canAcknowledgeFieldTask, fieldTaskStage, fieldTaskStatusLabel } from "@/lib/report-workflow";
import ActionFeedback from "@/components/reports/ActionFeedback";
import {
  FieldOutcomeBadge,
  ReportStatusBadge,
  RiskBadge,
} from "@/components/reports/RiskBadge";
import type { ReportRecord } from "@/types/database.types";

export default function FieldReportsListPage() {
  const { t } = useLanguage();
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const loadReports = useCallback(async () => {
    const all = await rakforestRepo.getReports();
    setReports(all);
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleAcknowledge(reportId: string) {
    setBusyId(reportId);
    setFailure(null);
    try {
      await rakforestRepo.acknowledgeFieldTask(reportId);
      await loadReports();
    } catch (error) {
      setFailure({ id: reportId, message: error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setBusyId(null);
    }
  }

  const closedCount = reports.filter((report) => report.status === "closed").length;
  const filtered = reports.filter((report) => (report.status === "closed") === (tab === "completed"));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#14241B]">{t("ภารกิจตรวจสอบเสาไมค์และประวัติการแจ้งเหตุภาคสนาม")}</h1>
          <p className="text-xs sm:text-sm text-[#526358]">{t("รับทราบใบงานจากศูนย์สั่งการ ลงพื้นที่ตรวจสอบรัศมีเสาไมโครโฟน และส่งผลการตรวจพื้นที่พร้อมรูปถ่าย")}</p>
        </div>

        <Link
          href="/report/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[#D62828] px-4 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-red-700"
        >
          <Mic className="h-4 w-4" />
          <span>{t("+ แจ้งเหตุฉุกเฉิน / อัดเสียงสด")}</span>
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-[#D4DCD5] pb-3">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition ${
            tab === "active"
              ? "bg-[#1B4332] text-white"
              : "bg-white border border-[#C6D1C8] text-[#526358]"
          }`}
        >{t("ภารกิจที่ต้องดำเนินการ (")}{reports.length - closedCount}
          )
        </button>
        <button
          type="button"
          onClick={() => setTab("completed")}
          className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition ${
            tab === "completed"
              ? "bg-[#1B4332] text-white"
              : "bg-white border border-[#C6D1C8] text-[#526358]"
          }`}
        >{t("ปิดงานแล้ว (")}{closedCount}
          )
        </button>
      </div>

      {/* Responsive Multi-Column Task Cards (1 col mobile, 2 cols tablet, 3 cols desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((item) => {
          const ai = item.report_audio?.[0]?.ai_classifications?.[0];
          const stage = fieldTaskStage(item);
          const workflowLabel = fieldTaskStatusLabel(item);
          return (
            <article
              key={item.id}
              className="rounded-lg border border-[#D4DCD5] bg-white p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-code text-xs font-bold text-[#14241B]">
                    {item.report_code}
                  </span>
                  <RiskBadge level={item.risk_level} size="xs" />
                </div>
                {workflowLabel && <p className="text-sm font-semibold text-[#1B4332]">{t(workflowLabel)}</p>}

                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 font-bold text-[#1B4332]">
                    {item.source_type === "station_sensor" ? (
                      <>
                        <Radio className="h-3.5 w-3.5" />
                        <span>
                          {item.sensor_stations?.station_code ?? "ST-01"} ·{" "}
                          {item.sensor_stations?.name ?? t("เสาไมค์")}
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>{t("แจ้งเหตุลาดตระเวนภาคสนาม")}</span>
                      </>
                    )}
                  </span>
                  <ReportStatusBadge status={item.status} />
                </div>

                {ai && (
                  <p className="text-xs text-[#14241B]">{t("เสียงที่ตรวจพบ:")}{" "}
                    <strong>{t(getClassNameTh(ai.predicted_label))}</strong> (
                    <span className="font-mono-code font-bold text-[#1B4332]">
                      {Math.round(ai.confidence * 100)}%
                    </span>
                    )
                  </p>
                )}

                <p className="rounded bg-[#F4F7F4] p-2.5 text-xs text-[#435449]">
                  {item.dispatch_note || item.description}
                </p>

                {item.field_outcome && (
                  <div className="pt-1">
                    <FieldOutcomeBadge outcome={item.field_outcome} />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-[#E4ECE6]">
                {canAcknowledgeFieldTask(item) && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => handleAcknowledge(item.id)}
                    className="flex-1 min-h-10 inline-flex items-center justify-center gap-1 rounded-lg bg-[#1B4332] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2D6A4F]"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>{t("รับทราบงาน")}</span>
                  </button>
                )}
                <Link
                  href={`/field-reports/${item.id}${stage === "in_progress" ? "#field-inspection" : ""}`}
                  className="flex-1 min-h-10 inline-flex items-center justify-center gap-1 rounded-lg border border-[#1B4332] bg-white px-3 py-2 text-xs font-semibold text-[#1B4332] hover:bg-[#EBF2ED]"
                >
                  <span>
                    {stage === "in_progress"
                      ? t("ส่งผลตรวจ")
                      : t("ดูรายละเอียด & แผนที่")}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {failure?.id === item.id && <ActionFeedback result={{ tone: "error", message: failure.message }} />}
            </article>
          );
        })}
      </div>
    </div>
  );
}
