import type { ReportRecord, ReportStatus } from "@/types/database.types";

export type BackofficeReportAction = "confirmed" | "rejected" | "field_reviewed" | "closed";

export function incidentDecision(status: ReportStatus) {
  return status === "confirmed" || status === "rejected" ? status : null;
}

export function fieldTaskStage(report: ReportRecord) {
  if (report.status === "closed") return "closed";
  if (report.submitted_at || report.status === "submitted") {
    return report.submitted_at && report.reviewed_at &&
      Date.parse(report.reviewed_at) >= Date.parse(report.submitted_at)
      ? "reviewed"
      : "submitted";
  }
  return report.acknowledged_at || report.status === "acknowledged" ? "in_progress" : "waiting";
}

export function canAcknowledgeFieldTask(report: ReportRecord) {
  return fieldTaskStage(report) === "waiting" && (report.status !== "rejected" || Boolean(report.assigned_to));
}

export function canDispatchFieldTask(report: ReportRecord) {
  const stage = fieldTaskStage(report);
  return stage === "waiting" || stage === "in_progress";
}

export function canCloseReport(report: ReportRecord) {
  const stage = fieldTaskStage(report);
  return stage === "reviewed" || (
    stage === "waiting" && report.status === "rejected" && !report.assigned_to && !report.dispatched_at
  );
}

export function fieldTaskStatusLabel(report: ReportRecord) {
  const stage = fieldTaskStage(report);
  if (stage === "submitted") return "ส่งผลแล้ว รอหลังบ้านตรวจ";
  if (stage === "reviewed") return "ตรวจผลแล้ว รอปิดงาน";
  return null;
}
