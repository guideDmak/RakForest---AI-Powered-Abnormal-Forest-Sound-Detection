"use client";
import { useLanguage } from "@/lib/i18n/language";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  CheckCircle2,
  MapPin,
  Radio,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { rakforestRepo } from "@/lib/supabase/repository";
import { EvidenceImageDialog } from "@/components/reports/EvidenceImageDialog";
import AudioWaveformPlayer from "@/components/reports/AudioWaveformPlayer";
import AIClassificationCard from "@/components/reports/AIClassificationCard";
import ActionFeedback, { type ActionResult } from "@/components/reports/ActionFeedback";
import { canCloseReport, canDispatchFieldTask, fieldTaskStage, fieldTaskStatusLabel, type BackofficeReportAction } from "@/lib/report-workflow";
import {
  FieldOutcomeBadge,
  ReportStatusBadge,
  RiskBadge,
} from "@/components/reports/RiskBadge";
import { getClassNameTh } from "@/lib/utils/risk";
import type { Profile, ReportRecord } from "@/types/database.types";

const RiskZoneMap = dynamic(() => import("@/components/map/RiskZoneMap"), {
  ssr: false,
});

const reviewActions = {
  confirmed: { label: "ยืนยันเหตุจริง", note: "ยืนยันเหตุผิดปกติจริงจากหลักฐานที่ตรวจสอบ", success: "บันทึกผลยืนยันเหตุจริงแล้ว" },
  rejected: { label: "ปฏิเสธ (เสียงรบกวน)", note: "สัญญาณรบกวนหรือเสียงธรรมชาติ ไม่พบการกระทำผิด", success: "บันทึกผลปฏิเสธรายงานแล้ว" },
  field_reviewed: { label: "ตรวจผลภาคสนามแล้ว", note: "ตรวจสอบผลการลงพื้นที่แล้ว", success: "ตรวจผลแล้ว รอปิดงาน" },
  closed: { label: "ปิดงาน", note: "ดำเนินการที่เกี่ยวข้องเสร็จครบและปิดงาน", success: "ปิดงานแล้ว" },
} satisfies Record<BackofficeReportAction, { label: string; note: string; success: string }>;

export default function BackofficeReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, language } = useLanguage();
  const { id } = use(params);
  const [report, setReport] = useState<ReportRecord | null>(null);
  const [openImage, setOpenImage] = useState<{ src: string; name: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rangers, setRangers] = useState<Profile[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [dispatchNote, setDispatchNote] = useState(
    "โปรดนำชุดเคลื่อนที่เร็วเข้าตรวจสอบพื้นที่ในรัศมีเสาไมค์และส่งภาพถ่ายยืนยัน"
  );
  const [sendTelegram, setSendTelegram] = useState(true);
  const [reviewNotes, setReviewNotes] = useState("");
  const [pendingDecision, setPendingDecision] = useState<BackofficeReportAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<ActionResult | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState<ActionResult | null>(null);

  const loadDetail = useCallback(async () => {
    const [rep, profiles] = await Promise.all([
      rakforestRepo.getReportById(id),
      rakforestRepo.getProfiles(),
    ]);
    setReport(rep);
    const fieldRangers = profiles.filter((p) => p.role === "field_ranger");
    setRangers(fieldRangers);
    if (rep?.assigned_to) {
      setAssigneeId(rep.assigned_to);
    } else if (fieldRangers[0]) {
      setAssigneeId(fieldRangers[0].id);
    }
    if (rep?.dispatch_note) {
      setDispatchNote(rep.dispatch_note);
    }
    if (rep?.review_notes) {
      setReviewNotes(rep.review_notes);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function refreshInspection() {
    setRefreshing(true);
    try {
      const latest = await rakforestRepo.getReportById(id);
      if (latest) setReport(latest);
    } finally {
      setRefreshing(false);
    }
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-[#D4DCD5] bg-white p-8 text-center">
        <p className="text-sm text-[#526358]">{t("กำลังโหลดข้อมูลรายงาน…")}</p>
      </div>
    );
  }

  const evidence = report.report_evidence?.filter((item) => /^https?:\/\//.test(item.file_url)) ?? [];
  const audio = report.report_audio?.[0];
  const ai = audio?.ai_classifications?.[0];
  const stage = fieldTaskStage(report);
  const assignedRanger = report.assignee ?? rangers.find((ranger) => ranger.id === report.assigned_to);
  const workflowLabel = fieldTaskStatusLabel(report);
  const canClose = canCloseReport(report);

  async function handleDispatch() {
    if (!report || !assigneeId) return;
    setBusy(true);
    setDispatchFeedback({ tone: "pending", message: "กำลังบันทึกการมอบหมายงาน…" });
    try {
      const result = await rakforestRepo.dispatchToFieldRanger({
        reportId: report.id,
        assigneeId,
        dispatchNote,
        sendTelegram,
      });
      setReport(result.report);
      setDispatchFeedback({
        tone: result.telegram === "failed" ? "warning" : "success",
        message: result.telegram === "sent"
          ? "บันทึกการมอบหมายงานภาคสนามและส่งแจ้งเตือนเข้า Telegram เรียบร้อยแล้ว"
          : result.telegram === "failed"
            ? "บันทึกการมอบหมายงานแล้ว แต่ส่ง Telegram ไม่สำเร็จ"
            : "บันทึกการมอบหมายงานภาคสนามแล้ว",
      });
    } catch (error) {
      setDispatchFeedback({ tone: "error", message: error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(action: BackofficeReportAction) {
    if (!report) return;
    setBusy(true);
    setReviewFeedback({ tone: "pending", message: "กำลังบันทึกผล…" });
    try {
      const updated = await rakforestRepo.reviewReportStatus({
        reportId: report.id,
        action,
        reviewNotes: reviewNotes.trim() || reviewActions[action].note,
      });
      setReport(updated);
      setPendingDecision(null);
      setReviewFeedback({
        tone: "success",
        message: reviewActions[action].success,
      });
    } catch (error) {
      setReviewFeedback({ tone: "error", message: error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setBusy(false);
    }
  }

  function openReview(action: BackofficeReportAction) {
    setReviewFeedback(null);
    setPendingDecision(action);
  }

  return (
    <div className="space-y-5">
      {/* Top Breadcrumb & Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/reports"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1B4332] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t("กลับหน้ารายการรายงาน")}</span>
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono-code text-xl sm:text-2xl font-bold text-[#14241B]">
              {report.report_code}
            </h1>
            <RiskBadge level={report.risk_level} size="md" />
            <ReportStatusBadge status={report.status} />
            {ai && (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold border ${
                  report.risk_level === "red"
                    ? "bg-red-50 text-[#D62828] border-red-200"
                    : report.risk_level === "yellow"
                      ? "bg-amber-50 text-[#B45309] border-amber-300"
                      : "bg-emerald-50 text-[#2D8A3E] border-emerald-200"
                }`}
              >
                <span>{t(getClassNameTh(ai.predicted_label))}</span>
                <span className="font-mono-code font-extrabold text-sm">
                  {Math.round(ai.confidence * 100)}%
                </span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[#526358]">{t("ตรวจพบเมื่อ")}{" "}
            {new Date(report.created_at).toLocaleString(language === "en" ? "en-GB" : "th-TH", {
              dateStyle: "long",
              timeStyle: "medium",
            })}{" "}
            •{" "}
            {report.source_type === "station_sensor"
              ? (t("สัญญาณจากเสาไมค์ ") + (report.sensor_stations?.station_code ?? "ST-01") + " (" + (report.sensor_stations?.name ?? "") + ")")
              : t("รายงานสดจากชุดลาดตระเวนภาคสนาม")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        <div className="contents lg:col-span-7 lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          {/* Interactive Audio Waveform & Segment Time Jump */}
          <section className="order-2 min-w-0 rounded-lg border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-3">
            <h2 className="text-base font-bold text-[#14241B]">{t("1. ตรวจสอบหลักฐานเสียงและช่วงเวลาที่ตรวจพบ (Interactive Audio Timeline)")}</h2>
            <AudioWaveformPlayer
              fileUrl={audio?.file_url}
              fileName={audio?.file_name}
              durationSeconds={audio?.duration_seconds}
              predictedLabel={ai?.predicted_label ?? "chainsaw"}
              segments={ai?.raw_response?.segments}
            />
          </section>

          {/* AI 9-Class Multi-Label Card */}
          {ai && (
            <div className="order-4 min-w-0">
              <AIClassificationCard
                predictedLabel={ai.predicted_label}
                confidence={ai.confidence}
                riskLevel={report.risk_level}
                modelVersion={ai.model_version}
                rawResponse={ai.raw_response}
              />
            </div>
          )}
        </div>
        <div className="contents lg:col-span-5 lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
          {/* GIS Location & Station Listening Radius Map */}
          <section className="order-1 min-w-0 rounded-xl shadow-sm border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-[#14241B]"><MapPin aria-hidden="true" className="size-5 shrink-0 text-[#2D6A4F]" />{t("ตำแหน่งพิกัดเกิดเหตุและวงรัศมีรับเสียงเสาไมค์")}</h2>
                <p className="font-mono-code text-xs text-[#526358]">
                  GPS: {report.lat.toFixed(5)}, {report.lng.toFixed(5)}
                  {report.forest_zones && <span> {t(" • โซน:")} {report.forest_zones.name}</span>}
                </p>
              </div>
              {report.sensor_stations && (
                <span className="inline-flex items-center gap-1 rounded bg-[#EBF2ED] px-2.5 py-1 font-mono-code text-xs font-bold text-[#1B4332]">
                  <Radio className="h-3.5 w-3.5" />
                  {report.sensor_stations.station_code}{t(" (รัศมี")}{" "}
                  {report.sensor_stations.radius_meters}{t(" ม.)")}</span>
              )}
            </div>

            <RiskZoneMap
              zones={report.forest_zones ? [report.forest_zones] : []}
              stations={report.sensor_stations ? [report.sensor_stations] : []}
              reports={[report]}
              selectedStationId={report.station_id}
              focusSelectedReport
              selectedReportId={report.id}
              heightClass="h-[240px] lg:h-[320px]"
              showLayerControls={false}
            />
          </section>

          {/* Panel A: Dispatch to Field Ranger + Telegram Notification */}
          <section className="order-3 min-w-0 rounded-lg border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-4">
            <div className="border-b border-[#E4ECE6] pb-3">
              <h2 className="text-base font-bold text-[#14241B]">{t("2. มอบหมายชุดปฏิบัติการภาคสนาม (Field Dispatch)")}</h2>
              {stage !== "closed" && <p className="text-xs text-[#526358]">{t("สั่งการให้เจ้าหน้าที่พิทักษ์ป่าลงพื้นที่ตรวจสอบรอบเสาไมค์ พร้อมส่งแจ้งเตือนผ่าน Telegram")}</p>}
            </div>

            {stage === "closed" ? (
              <dl className="space-y-3 rounded-lg bg-[#F4F8F5] p-4 text-sm">
                <div>
                  <dt className="text-xs text-[#526358]">{t("เจ้าหน้าที่ภาคสนามผู้รับผิดชอบ")}</dt>
                  <dd className="mt-1 font-semibold">{assignedRanger?.full_name ?? report.assigned_to ?? t("ไม่มีข้อมูลผู้รับผิดชอบ")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#526358]">{t("คำสั่งการ / จุดเน้นในการตรวจสอบพื้นที่")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{report.dispatch_note || t("ไม่มีบันทึกเพิ่มเติม")}</dd>
                </div>
              </dl>
            ) : (
              <>
                <div>
                  <label htmlFor="dispatch-ranger" className="block text-xs font-semibold text-[#14241B] mb-1">{t("เจ้าหน้าที่ภาคสนามผู้รับผิดชอบ")}</label>
                  <select
                    id="dispatch-ranger"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full rounded-lg border border-[#B8C7BC] bg-white px-3 py-2 text-xs sm:text-sm"
                  >
                    {rangers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.employee_code} · {r.full_name} ({r.department})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="dispatch-note" className="block text-xs font-semibold text-[#14241B] mb-1">{t("คำสั่งการ / จุดเน้นในการตรวจสอบพื้นที่")}</label>
                  <textarea
                    id="dispatch-note"
                    rows={3}
                    value={dispatchNote}
                    onChange={(e) => setDispatchNote(e.target.value)}
                    className="w-full rounded-lg border border-[#B8C7BC] bg-white p-3 text-xs sm:text-sm"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs font-medium text-[#14241B] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendTelegram}
                    onChange={(e) => setSendTelegram(e.target.checked)}
                  />
                  <span>{t("ส่งข้อความแจ้งเตือนด่วนเข้า Telegram ของชุดปฏิบัติการทันที")}</span>
                </label>

                <button
                  type="button"
                  disabled={busy || !assigneeId || !canDispatchFieldTask(report)}
                  onClick={handleDispatch}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#1B4332] px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#2D6A4F] disabled:opacity-50 transition"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {!report.dispatched_at && report.status !== "dispatched"
                      ? t("มอบหมายงานภาคสนาม & แจ้งเตือน Telegram")
                      : t("อัปเดตคำสั่งการ & ส่งแจ้งเตือนซ้ำ")}
                  </span>
                </button>
              </>
            )}
            <ActionFeedback result={dispatchFeedback} />
          </section>

          {/* Panel B: Field Ranger Inspection Result & Evidence Gallery */}
          <section className="order-5 min-w-0 rounded-lg border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E4ECE6] pb-3">
              <h2 className="text-base font-bold text-[#14241B]">{t("3. ผลการลงพื้นที่ตรวจสอบของเจ้าหน้าที่ภาคสนาม")}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {report.field_outcome && <FieldOutcomeBadge outcome={report.field_outcome} />}
                <button type="button" disabled={refreshing || busy} onClick={() => void refreshInspection()}
                  className="rounded-md border border-[#B8C7BC] px-2.5 py-1.5 text-xs font-semibold text-[#1B4332] disabled:opacity-50">
                  {t(refreshing ? "กำลังอัปเดตผลตรวจ…" : "อัปเดตผลตรวจ")}
                </button>
              </div>
            </div>

            {report.field_outcome || report.submitted_at ? (
              <div className="space-y-3 text-xs">
                <p className="rounded-lg border border-[#D4DCD5] bg-[#F8FAF8] p-3 text-[#14241B] leading-relaxed whitespace-pre-wrap break-words">
                  {report.field_notes || t("ไม่มีบันทึกเพิ่มเติม")}
                </p>
                {report.submitted_at && (
                  <p className="text-[#526358]">{t("ส่งผลเมื่อ:")}{" "}
                    {new Date(report.submitted_at).toLocaleString(language === "en" ? "en-GB" : "th-TH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#C6D1C8] bg-[#F8FAF8] p-4 text-xs text-[#526358]">
                {stage === "in_progress"
                  ? t("เจ้าหน้าที่ภาคสนามรับทราบงานแล้ว กำลังเดินทางเข้าตรวจสอบพื้นที่รอบเสาไมค์")
                  : report.dispatched_at || report.status === "dispatched"
                    ? t("ส่งใบงานแล้ว รอเจ้าหน้าที่ภาคสนามกดรับทราบงานและลงพื้นที่")
                    : t("ยังไม่มีผลตรวจภาคสนาม (คุณสามารถสลับไปโหมดภาคสนามเพื่อจำลองการรับงานและส่งผลได้ทันที)")}
                <div className="mt-2">
                  <Link
                    href={`/reports/${report.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      window.location.href = `/home`;
                    }}
                    className="font-semibold text-[#1B4332] hover:underline"
                  >{t("เปิดหน้าจอเจ้าหน้าที่ภาคสนามเพื่อรับงานนี้ →")}</Link>
                </div>
              </div>
            )}

            {/* Evidence Photos */}
            {evidence.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-semibold text-[#526358] mb-2">{t("ภาพถ่าย/วิดีโอหลักฐานจากจุดเกิดเหตุ (")}{evidence.length}):
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {evidence.map((item) => {
                    const name = item.file_name ?? t("ภาพหลักฐาน");
                    const tileClass = "block w-full overflow-hidden rounded-lg border border-[#D4DCD5] bg-slate-100 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4332]";
                    if (item.file_type === "video") {
                      return (
                        <a key={item.id} href={item.file_url} target="_blank" rel="noreferrer" className={tileClass}>
                          <span className="block break-words px-2 py-1.5 text-xs font-semibold">{name}</span>
                        </a>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-haspopup="dialog"
                        onClick={() => setOpenImage({ src: item.file_url, name })}
                        className={tileClass + " cursor-zoom-in hover:bg-slate-200"}
                      >
                        <img src={item.file_url} alt="" className="h-32 w-full object-contain" loading="lazy" decoding="async" />
                        <span className="block break-words px-2 py-1.5 text-xs font-semibold">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Panel C: Backoffice Official Verification & Audit Decision */}
          <section className="order-6 min-w-0 rounded-lg border border-[#D4DCD5] bg-white p-4 sm:p-5 space-y-4">
            <div className="border-b border-[#E4ECE6] pb-3">
              <h2 className="text-base font-bold text-[#14241B]">{t("4. การยืนยันผลและปิดงานโดยศูนย์สั่งการ")}</h2>
              <p className="text-xs text-[#526358]">{t("บันทึกผลการพิจารณาขั้นสุดท้ายเพื่อเก็บในประวัติปฏิบัติการและใช้พัฒนาความแม่นยำของระบบ AI")}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#14241B] mb-1">{t("บันทึกสรุปผลการตรวจสอบของเจ้าหน้าที่ส่วนกลาง")}</label>
              <textarea
                rows={2}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder={t("ระบุสรุปผลการตรวจสอบหรือเหตุผลในการปิดงาน...")}
                className="w-full rounded-lg border border-[#B8C7BC] bg-white p-2.5 text-xs sm:text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={busy || stage === "closed"}
                onClick={() => openReview("confirmed")}
                className="min-h-11 flex items-center justify-center gap-1.5 rounded-lg bg-[#D62828] px-3 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>{t("ยืนยันเหตุจริง")}</span>
              </button>

              <button
                type="button"
                disabled={busy || stage === "closed"}
                onClick={() => openReview("rejected")}
                className="min-h-11 flex items-center justify-center gap-1.5 rounded-lg border border-[#C6D1C8] bg-white px-3 py-2.5 text-xs sm:text-sm font-semibold text-[#526358] hover:bg-slate-100 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{t("ปฏิเสธ (เสียงรบกวน)")}</span>
              </button>

              <button
                type="button"
                disabled={busy || !canClose}
                onClick={() => openReview("closed")}
                className="min-h-11 flex items-center justify-center gap-1.5 rounded-lg bg-[#2D8A3E] px-3 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{t("ปิดงาน")}</span>
              </button>
            </div>
            {workflowLabel && <p className="text-sm font-semibold text-[#1B4332]">{t(workflowLabel)}</p>}
            {stage === "submitted" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => openReview("field_reviewed")}
                className="min-h-11 inline-flex items-center gap-2 rounded-lg border border-[#1B4332] px-4 py-2 text-sm font-semibold text-[#1B4332] hover:bg-[#EBF2ED] disabled:opacity-50"
              >
                <CheckCircle2 aria-hidden="true" className="size-4" />
                {t(reviewActions.field_reviewed.label)}
              </button>
            )}
            {!canClose && stage !== "closed" && (
              <p className="text-xs text-[#526358]">{t("ตรวจผลภาคสนามก่อนปิดงาน")}</p>
            )}

            {/* Confirmation Dialog Box to prevent accidental clicks */}
            {pendingDecision && (
              <div
                role="alertdialog"
                aria-labelledby="confirm-decision-title"
                className="rounded-lg border-2 border-[#1B4332] bg-[#F4F8F5] p-4 space-y-3"
              >
                <div>
                  <p
                    id="confirm-decision-title"
                    className="text-sm font-bold text-[#14241B]"
                  >{t("ยืนยันการดำเนินการ")} {t(reviewActions[pendingDecision].label)}</p>
                  <p className="mt-1 text-xs text-[#526358]">
                    {pendingDecision === "closed"
                      ? t("ยืนยันว่าตรวจผลและดำเนินการที่เกี่ยวข้องเสร็จครบแล้วก่อนปิดงาน")
                      : t("โปรดตรวจสอบความถูกต้องก่อนกดยืนยัน ระบบจะบันทึกประวัติการตัดสินใจลงฐานข้อมูลทันที")}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReview(pendingDecision)}
                    className="min-h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-[#1B4332] px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-[#2D6A4F] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {busy
                        ? t("กำลังบันทึกผล…")
                        : t("ใช่, ยืนยันการบันทึกผลนี้")}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setReviewFeedback(null); setPendingDecision(null); }}
                    className="min-h-11 inline-flex items-center justify-center rounded-lg border border-[#B8C7BC] bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-[#14241B] hover:bg-slate-100"
                  >{t("ยกเลิก (ย้อนกลับ)")}</button>
                </div>
              </div>
            )}
            <ActionFeedback result={reviewFeedback} />
          </section>
        </div>
      </div>
      {openImage && <EvidenceImageDialog {...openImage} onClose={() => setOpenImage(null)} />}
    </div>
  );
}
