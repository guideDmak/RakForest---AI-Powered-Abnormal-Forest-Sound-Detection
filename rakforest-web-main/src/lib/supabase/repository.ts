"use client";

import { createClient } from "./client";
import { readZones,readStations,writeZone,writeStation } from "@/lib/directory/service";
import { listAccounts, createAccountRecord, requireAccountAdmin, changeAccountRole, resetAccountPassword } from "@/lib/accounts/service";
import type { CreateAccountInput } from "@/lib/accounts/validation";
import type { AudioModelId } from "@/lib/ml-contract";
import { canAcknowledgeFieldTask, canCloseReport, canDispatchFieldTask, fieldTaskStage, incidentDecision, type BackofficeReportAction } from "@/lib/report-workflow";
import {
  INITIAL_NOTIFICATION_LOGS,
  INITIAL_NOTIFICATION_RULES,
  INITIAL_PROFILES,
  INITIAL_REPORTS,
  INITIAL_STATIONS,
  INITIAL_ZONES,
} from "./fallback-seed";
import type {
  AIRawResponse,
  AuditLog,
  FieldOutcome,
  ForestZone,
  NotificationLog,
  NotificationRule,
  Profile,
  ReportRecord,
  RiskLevel,
  SensorStation,
  SourceType,
  UserRole,
  UserNotification,
} from "@/types/database.types";

const LOCAL_CACHE_KEY = "rakforest-operational-cache-v1";
const SESSION_USER_KEY = "rakforest-active-profile-v1";

interface OperationalCache {
  profiles: Profile[];
  zones: ForestZone[];
  stations: SensorStation[];
  reports: ReportRecord[];
  rules: NotificationRule[];
  notifications: NotificationLog[];
  userNotifications: UserNotification[];
  auditLogs: AuditLog[];
}

function loadLocalCache(): OperationalCache {
  if (typeof window === "undefined") {
    return {
      profiles: structuredClone(INITIAL_PROFILES),
      zones: structuredClone(INITIAL_ZONES),
      stations: structuredClone(INITIAL_STATIONS),
      reports: structuredClone(INITIAL_REPORTS),
      rules: structuredClone(INITIAL_NOTIFICATION_RULES),
      notifications: structuredClone(INITIAL_NOTIFICATION_LOGS),
      userNotifications: [],
      auditLogs: [],
    };
  }
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OperationalCache>;
      return {
        profiles: parsed.profiles ?? structuredClone(INITIAL_PROFILES),
        zones: parsed.zones?.length ? parsed.zones : structuredClone(INITIAL_ZONES),
        stations: parsed.stations?.length ? parsed.stations : structuredClone(INITIAL_STATIONS),
        reports: parsed.reports?.length ? parsed.reports : structuredClone(INITIAL_REPORTS),
        rules: parsed.rules?.length ? parsed.rules : structuredClone(INITIAL_NOTIFICATION_RULES),
        notifications: parsed.notifications ?? structuredClone(INITIAL_NOTIFICATION_LOGS),
        userNotifications: parsed.userNotifications ?? [],
        auditLogs: parsed.auditLogs ?? [],
      };
    }
  } catch {
    // ignore storage parse error
  }
  const initial: OperationalCache = {
    profiles: structuredClone(INITIAL_PROFILES),
    zones: structuredClone(INITIAL_ZONES),
    stations: structuredClone(INITIAL_STATIONS),
    reports: structuredClone(INITIAL_REPORTS),
    rules: structuredClone(INITIAL_NOTIFICATION_RULES),
    notifications: structuredClone(INITIAL_NOTIFICATION_LOGS),
    userNotifications: [],
    auditLogs: [],
  };
  saveLocalCache(initial);
  return initial;
}

function saveLocalCache(cache: OperationalCache) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
    window.dispatchEvent(new CustomEvent("rakforest-data-updated"));
  } catch {
    // ignore quota error
  }
}

function enrichReports(
  reports: ReportRecord[],
  zones: ForestZone[],
  stations: SensorStation[],
  profiles: Profile[]
): ReportRecord[] {
  return reports.map((r) => ({
    ...r,
    forest_zones: r.forest_zones ?? zones.find((z) => z.id === r.zone_id) ?? null,
    sensor_stations:
      r.sensor_stations ?? stations.find((s) => s.id === r.station_id) ?? null,
    reporter: r.reporter ?? profiles.find((p) => p.id === r.reporter_id) ?? null,
    assignee: r.assignee ?? profiles.find((p) => p.id === r.assigned_to) ?? null,
  }));
}

async function uploadReportMedia(
  supabase: ReturnType<typeof createClient>,
  bucket: "audio-reports" | "evidence-files",
  path: string,
  file: File,
): Promise<string> {
  try {
    const storage = supabase.storage.from(bucket);
    const { error } = await storage.upload(path, file, { upsert: true });
    if (!error) return storage.getPublicUrl(path).data.publicUrl;
  } catch {
    // Preserve the local preview when Storage is unavailable.
  }
  return typeof window === "undefined" ? "" : URL.createObjectURL(file);
}

function uploadReportEvidence(
  supabase: ReturnType<typeof createClient>,
  files: File[],
  report: { id: string; code: string; uploaderId: string; uploadedAt: string },
): Promise<NonNullable<ReportRecord["report_evidence"]>> {
  return Promise.all(files.map(async (file) => {
    const id = crypto.randomUUID();
    const fileUrl = await uploadReportMedia(supabase, "evidence-files", `${report.code}/${id}-${file.name}`, file);
    return {
      id,
      report_id: report.id,
      file_url: fileUrl,
      file_name: file.name,
      file_type: file.type.startsWith("video/") ? "video" : "image",
      uploaded_by: report.uploaderId,
      uploaded_at: report.uploadedAt,
    };
  }));
}

async function classifyReportAudio(file: File, requestId: string, stationId: string, modelId: AudioModelId) {
  const formData = new FormData();
  formData.set("audio", file);
  formData.set("requestId", requestId);
  formData.set("stationId", stationId);
  formData.set("modelId", modelId);
  try {
    const response = await fetch("/api/classify-audio", { method: "POST", body: formData });
    if (response.ok) {
      return await response.json() as {
        rawResponse: AIRawResponse;
        predictedLabel: string;
        confidence: number;
        riskLevel: RiskLevel;
        processedAt?: string;
      };
    }
  } catch {
    // A report can be saved for manual review when analysis is unavailable.
  }
  return null;
}

async function updateReportWorkflow(
  supabase: ReturnType<typeof createClient>,
  current: ReportRecord,
  changes: Partial<ReportRecord>,
  message = "สถานะรายงานเปลี่ยนแล้วหรือบันทึกไม่สำเร็จ กรุณาโหลดใหม่",
) {
  const request = supabase.from("reports").update(changes).eq("id", current.id).eq("status", current.status);
  const { data, error } = await (current.updated_at
    ? request.eq("updated_at", current.updated_at)
    : request.is("updated_at", null)).select("id,updated_at").single();
  if (error || !data) throw new Error(message);
  return data.updated_at ?? changes.updated_at;
}

export const rakforestRepo = {
  // ==========================================================================
  // AUTH & CURRENT PROFILE
  // ==========================================================================
  async getCurrentProfile(): Promise<Profile | null> {
    const supabase = createClient();
    let id: string | undefined;
    try {const {data:{user}}=await supabase.auth.getUser();id=user?.id;}catch { /* Use the existing prototype session ID below. */ }
    if(!id&&typeof window!=="undefined"){
      try {id=JSON.parse(localStorage.getItem(SESSION_USER_KEY)||"null")?.id;}catch{return null;}
    }
    if(!id)return null;
    const {data,error}=await supabase.from("profiles").select("*").eq("id",id).single();
    if(error)return null;
    if(data.deleted_at||data.role==="suspended"||data.role==="pending_verification"){
      if(typeof window!=="undefined")localStorage.removeItem(SESSION_USER_KEY);
      return null;
    }
    return data as Profile;
  },

  async signIn(identifier: string, password: string): Promise<Profile> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const clean = identifier.trim().toLowerCase();

    // 1. Try real Supabase Auth first
    const emailCandidate = clean.includes("@")
      ? clean
      : cache.profiles.find((p) => p.employee_code?.toLowerCase() === clean)?.email ??
        `${clean}@rakforest.go.th`;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailCandidate,
        password,
      });

      if (!error && data.user) {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .maybeSingle();

        if (profileRow) {
          const p = profileRow as Profile;
          if (p.role === "pending_verification") {
            throw new Error("บัญชีของคุณอยู่ระหว่างรอการอนุมัติยืนยันตัวตนจากผู้ดูแลระบบ");
          }
          if (p.deleted_at || p.role === "suspended") {
            throw new Error("บัญชีนี้ถูกระงับสิทธิ์การใช้งานชั่วคราว กรุณาติดต่อศูนย์สั่งการ");
          }
          if (typeof window !== "undefined") {
            localStorage.setItem(SESSION_USER_KEY, JSON.stringify(p));
          }
          return p;
        }
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes("รอการอนุมัติ") || err.message.includes("ระงับสิทธิ์"))
      ) {
        throw err;
      }
    }

    // 2. Match against operational profiles (by email or employee_code)
    const allProfiles = await this.getProfiles({strict:true});
    const matched = allProfiles.find(
      (p) =>
        p.email?.toLowerCase() === clean ||
        p.employee_code?.toLowerCase() === clean
    );

    if (!matched) {
      throw new Error("ไม่พบรหัสพนักงานหรืออีเมลนี้ในระบบ กรุณาตรวจสอบข้อมูลอีกครั้ง");
    }

    const expectedPassword = matched.password_hash || "RakForest2026!";
    if (password !== expectedPassword) {
      throw new Error("รหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านอีกครั้ง");
    }
    if (matched.role === "pending_verification") {
      throw new Error("บัญชีของคุณอยู่ระหว่างรอการอนุมัติยืนยันตัวตนจากผู้ดูแลระบบ");
    }
    if (matched.deleted_at || matched.role === "suspended") {
      throw new Error("บัญชีนี้ถูกระงับสิทธิ์การใช้งานชั่วคราว กรุณาติดต่อศูนย์สั่งการ");
    }

    if (typeof window !== "undefined") {
      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(matched));
    }
    return matched;
  },

  async signOut(): Promise<void> {
    const supabase = createClient();
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    if (typeof window !== "undefined") {
      localStorage.removeItem(SESSION_USER_KEY);
    }
  },

  // ==========================================================================
  // FOREST ZONES & SENSOR STATIONS
  // ==========================================================================
  async getZones(): Promise<ForestZone[]> {
    const zones=await readZones();const cache=loadLocalCache();cache.zones=zones;saveLocalCache(cache);return zones;
  },
  async saveZone(zone:Partial<ForestZone>&{name:string;polygon_coords:[number,number][]}):Promise<ForestZone>{
    const saved=await writeZone(zone);const cache=loadLocalCache();cache.zones=[saved,...cache.zones.filter(z=>z.id!==saved.id)];saveLocalCache(cache);return saved;
  },
  async getStations():Promise<SensorStation[]>{
    const stations=await readStations();const cache=loadLocalCache();cache.stations=[...stations,...cache.stations.filter(s=>s.deleted_at&&!stations.some(n=>n.id===s.id))];saveLocalCache(cache);return stations;
  },
  async saveStation(station:Partial<SensorStation>&{station_code:string;name:string;lat:number;lng:number}):Promise<SensorStation>{
    const saved=await writeStation(station);const cache=loadLocalCache();cache.stations=[saved,...cache.stations.filter(s=>s.id!==saved.id)];saveLocalCache(cache);return saved;
  },

  // ==========================================================================
  // REPORTS, AUDIO & AI CLASSIFICATION
  // ==========================================================================
  async getReports(): Promise<ReportRecord[]> {
    const supabase = createClient();

    try {
      const { data, error } = await supabase
        .from("reports")
        .select(
          `*,
          report_audio(*, ai_classifications(*)),
          report_evidence(*),
          forest_zones(*),
          sensor_stations(*),
          reporter:profiles!reports_reporter_id_fkey(*),
          assignee:profiles!reports_assigned_to_fkey(*)`
        )
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        const cache = loadLocalCache();
        const enriched = enrichReports(
          data as ReportRecord[],
          cache.zones,
          cache.stations,
          cache.profiles
        );
        cache.reports = enriched;
        saveLocalCache(cache);
        return enriched;
      }
    } catch {
      // fallback
    }

    const cache = loadLocalCache();
    return enrichReports(
      cache.reports,
      cache.zones,
      cache.stations,
      cache.profiles
    ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  },

  async getReportById(idOrCode: string): Promise<ReportRecord | null> {
    const all = await this.getReports();
    return (
      all.find((r) => r.id === idOrCode || r.report_code === idOrCode) ?? null
    );
  },

  async createReportWithAudio(params: {
    sourceType: SourceType;
    stationId?: string | null;
    zoneId?: string | null;
    lat: number;
    lng: number;
    description?: string;
    audioFile?: File | null;
    modelId?: AudioModelId;
    evidenceFiles?: File[];
    reporterId?: string | null;
  }): Promise<{ report: ReportRecord; aiResult: AIRawResponse | null }> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const profile = await this.getCurrentProfile();
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่ บัญชีอาจถูกระงับหรือลบแล้ว");

    const station = params.stationId
      ? cache.stations.find(
          (s) => s.id === params.stationId || s.station_code === params.stationId
        )
      : null;
    if(params.stationId && (!station || station.deleted_at))throw new Error("ไมค์นี้ไม่พร้อมใช้งาน กรุณาเลือกใหม่");
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่");
    const zoneId =
      params.zoneId !== undefined ? params.zoneId : station?.zone_id ?? null;

    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
    const seq = String(cache.reports.length + 1).padStart(3, "0");
    const reportCode = `RF-${datePart}-${seq}`;
    const reportId = crypto.randomUUID();

    const [audioFileUrl, evidenceItems, analysis] = await Promise.all([
      params.audioFile
        ? uploadReportMedia(supabase, "audio-reports", `${reportCode}/${reportId}-${params.audioFile.name}`, params.audioFile)
        : "",
      uploadReportEvidence(supabase, params.evidenceFiles ?? [], {
        id: reportId,
        code: reportCode,
        uploaderId: profile.id,
        uploadedAt: now.toISOString(),
      }),
      params.audioFile
        ? classifyReportAudio(params.audioFile, reportCode, station?.station_code ?? "FIELD-GPS", params.modelId ?? "cnn_sigmoid")
        : null,
    ]);

    const aiRaw = analysis?.rawResponse ?? null;
    const predictedLabel = analysis?.predictedLabel ?? "";
    const confidence = analysis?.confidence ?? 0;
    const riskLevel = analysis?.riskLevel ?? "green";
    const processedAt = analysis?.processedAt;

    const audioId = crypto.randomUUID();
    const classification = aiRaw && processedAt ? {
      id: crypto.randomUUID(),
      report_audio_id: audioId,
      predicted_label: predictedLabel,
      confidence,
      raw_response: aiRaw,
      model_version: aiRaw.modelVersion ?? null,
      processed_at: processedAt,
    } : null;
    let analysisSaved = false;

    const newReport: ReportRecord = {
      id: reportId,
      report_code: reportCode,
      source_type: params.sourceType,
      reporter_id: params.reporterId ?? profile?.id ?? cache.profiles[0].id,
      zone_id: zoneId,
      station_id: station?.id ?? null,
      lat: params.lat,
      lng: params.lng,
      description:
        params.description?.trim() ||
        (station
          ? `สัญญาณเสียงตรวจพบจาก ${station.station_code} (${station.name})`
          : "รายงานเหตุการณ์ภาคสนามพร้อมไฟล์เสียง"),
      status: "pending",
      risk_level: riskLevel,
      assigned_to: null,
      dispatch_note: null,
      dispatched_at: null,
      acknowledged_at: null,
      field_outcome: null,
      field_notes: null,
      submitted_at: null,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      report_audio: params.audioFile
        ? [
            {
              id: audioId,
              report_id: reportId,
              file_url: audioFileUrl,
              file_name: params.audioFile.name,
              duration_seconds:
                aiRaw?.segments?.at(-1)?.endSeconds ?? 8,
              uploaded_at: now.toISOString(),
              ai_classifications: classification ? [classification] : [],
            },
          ]
        : [],
      report_evidence: evidenceItems,
    };

    // Persist to Supabase tables if available
    try {
      const {error:reportError}=await supabase.from("reports").insert({
        id: newReport.id,
        report_code: newReport.report_code,
        source_type: newReport.source_type,
        reporter_id: newReport.reporter_id,
        zone_id: newReport.zone_id,
        station_id: newReport.station_id,
        lat: newReport.lat,
        lng: newReport.lng,
        description: newReport.description,
        status: newReport.status,
        risk_level: newReport.risk_level,
        created_at: newReport.created_at,
      });

      if(reportError)throw new Error("บันทึกรายงานไม่สำเร็จ ไมค์หรือเจ้าหน้าที่อาจถูกลบ กรุณาโหลดข้อมูลใหม่");
      if (params.audioFile) {
        const { error: audioError } = await supabase.from("report_audio").insert({
          id: audioId,
          report_id: reportId,
          file_url: audioFileUrl,
          file_name: params.audioFile.name,
          duration_seconds: aiRaw?.segments?.at(-1)?.endSeconds ?? 8,
        });

        if (classification && !audioError) {
          const { error } = await supabase.from("ai_classifications").insert(classification);
          analysisSaved = !error;
        }
      }

      if (evidenceItems.length > 0) {
        await supabase.from("report_evidence").insert(
          evidenceItems.map((ev) => ({
            id: ev.id,
            report_id: ev.report_id,
            file_url: ev.file_url,
            file_name: ev.file_name,
            file_type: ev.file_type,
            uploaded_by: ev.uploaded_by,
          }))
        );
      }
    } catch (error) {
      throw error instanceof Error?error:new Error("บันทึกรายงานไม่สำเร็จ");
    }

    cache.reports.unshift(newReport);
    saveLocalCache(cache);

    if (analysisSaved && aiRaw?.source === "http" && (riskLevel === "red" || riskLevel === "yellow")) {
      await this.dispatchTelegramNotification({
        mode: "automatic",
        reportId: newReport.id,
        reportCode: newReport.report_code,
        riskLevel,
        predictedLabel,
        confidence,
        locationText: "",
      });
    }

    return {
      report: enrichReports(
        [newReport],
        cache.zones,
        cache.stations,
        cache.profiles
      )[0],
      aiResult: aiRaw,
    };
  },

  async dispatchToFieldRanger(params: {
    reportId: string;
    assigneeId: string;
    dispatchNote: string;
    sendTelegram?: boolean;
  }): Promise<{ report: ReportRecord; telegram: "disabled" | "sent" | "failed" }> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const profile = await this.getCurrentProfile();
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่ บัญชีอาจถูกระงับหรือลบแล้ว");
    const now = new Date().toISOString();

    const idx = cache.reports.findIndex((r) => r.id === params.reportId);
    if (idx === -1) throw new Error("ไม่พบรายการรายงานนี้");

    const current = cache.reports[idx];
    if (!canDispatchFieldTask(current)) throw new Error("ภารกิจนี้ส่งผลแล้วหรือปิดงานแล้ว");
    const sameAssignee = current.assigned_to === params.assigneeId;
    const changes = {
      status: incidentDecision(current.status) ?? (sameAssignee && fieldTaskStage(current) === "in_progress" ? "acknowledged" : "dispatched"),
      assigned_to: params.assigneeId,
      acknowledged_at: sameAssignee ? current.acknowledged_at : null,
      dispatch_note: params.dispatchNote.trim(),
      dispatched_at: now,
      updated_at: now,
    } satisfies Partial<ReportRecord>;
    const updatedAt = await updateReportWorkflow(supabase, current, changes, "มอบหมายงานไม่สำเร็จ เจ้าหน้าที่อาจถูกลบหรือข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่");
    const updated = { ...current, ...changes, updated_at: updatedAt ?? now };
    cache.reports[idx] = updated;

    cache.auditLogs.unshift({
      id: crypto.randomUUID(),
      actor_id: profile?.id ?? null,
      actor_name: profile?.full_name ?? "เจ้าหน้าที่ส่วนกลาง",
      action: "dispatch_field_task",
      target_table: "reports",
      target_id: updated.id,
      details: {
        assigned_to: params.assigneeId,
        dispatch_note: params.dispatchNote,
      },
      created_at: now,
    });

    saveLocalCache(cache);

    let telegram: "disabled" | "sent" | "failed" = "disabled";
    if (params.sendTelegram !== false) {
      const station = cache.stations.find((s) => s.id === updated.station_id);
      const ranger = cache.profiles.find((p) => p.id === params.assigneeId);
      const topClass =
        updated.report_audio?.[0]?.ai_classifications?.[0]?.predicted_label ??
        "chainsaw";
      const topConf =
        updated.report_audio?.[0]?.ai_classifications?.[0]?.confidence ?? 0.85;

      const notification = await this.dispatchTelegramNotification({
        reportId: updated.id,
        reportCode: updated.report_code,
        riskLevel: updated.risk_level,
        predictedLabel: topClass,
        confidence: topConf,
        locationText: station
          ? `${station.station_code} · ${station.name}`
          : `${updated.lat.toFixed(4)}, ${updated.lng.toFixed(4)}`,
        note: `มอบหมายให้ ${ranger?.full_name ?? "เจ้าหน้าที่ภาคสนาม"}: ${params.dispatchNote}`,
      });
      telegram = notification?.status === "sent" ? "sent" : "failed";
    }

    return {
      report: enrichReports([updated], cache.zones, cache.stations, cache.profiles)[0],
      telegram,
    };
  },

  async acknowledgeFieldTask(reportId: string): Promise<ReportRecord> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const profile = await this.getCurrentProfile();
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่ บัญชีอาจถูกระงับหรือลบแล้ว");
    const now = new Date().toISOString();

    const idx = cache.reports.findIndex((r) => r.id === reportId);
    if (idx === -1) throw new Error("ไม่พบงานนี้");

    const current = cache.reports[idx];
    if (!canAcknowledgeFieldTask(current)) throw new Error("ภารกิจนี้ไม่อยู่ในขั้นรับทราบงาน");
    const changes = {
      status: incidentDecision(current.status) ?? "acknowledged",
      acknowledged_at: now,
      updated_at: now,
    } satisfies Partial<ReportRecord>;
    const updatedAt = await updateReportWorkflow(supabase, current, changes);
    cache.reports[idx] = { ...current, ...changes, updated_at: updatedAt ?? now };

    cache.auditLogs.unshift({
      id: crypto.randomUUID(),
      actor_id: profile?.id ?? null,
      actor_name: profile?.full_name ?? "เจ้าหน้าที่ภาคสนาม",
      action: "acknowledge_task",
      target_table: "reports",
      target_id: reportId,
      details: {},
      created_at: now,
    });

    saveLocalCache(cache);
    return enrichReports(
      [cache.reports[idx]],
      cache.zones,
      cache.stations,
      cache.profiles
    )[0];
  },

  async submitFieldInspection(params: {
    reportId: string;
    outcome: FieldOutcome;
    fieldNotes: string;
    evidenceFiles?: File[];
  }): Promise<ReportRecord> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const profile = await this.getCurrentProfile();
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่ บัญชีอาจถูกระงับหรือลบแล้ว");
    const now = new Date().toISOString();

    const idx = cache.reports.findIndex((r) => r.id === params.reportId);
    if (idx === -1) throw new Error("ไม่พบงานนี้");

    const current = cache.reports[idx];
    if (fieldTaskStage(current) !== "in_progress") throw new Error("ส่งผลตรวจได้เมื่อภารกิจกำลังดำเนินการ");
    const addedEvidence = await uploadReportEvidence(supabase, params.evidenceFiles ?? [], {
      id: current.id,
      code: current.report_code,
      uploaderId: profile.id,
      uploadedAt: now,
    });

    const changes = {
      status: incidentDecision(current.status) ?? "submitted",
      field_outcome: params.outcome,
      field_notes: params.fieldNotes.trim(),
      submitted_at: now,
      reviewed_at: null,
      updated_at: now,
    } satisfies Partial<ReportRecord>;
    const updatedAt = await updateReportWorkflow(supabase, current, changes);
    const updated = {
      ...current,
      ...changes,
      updated_at: updatedAt ?? now,
      report_evidence: [...(current.report_evidence ?? []), ...addedEvidence],
    };
    cache.reports[idx] = updated;

    cache.auditLogs.unshift({
      id: crypto.randomUUID(),
      actor_id: profile?.id ?? null,
      actor_name: profile?.full_name ?? "เจ้าหน้าที่ภาคสนาม",
      action: "submit_field_outcome",
      target_table: "reports",
      target_id: current.id,
      details: { outcome: params.outcome, notes: params.fieldNotes },
      created_at: now,
    });

    saveLocalCache(cache);
    return enrichReports([updated], cache.zones, cache.stations, cache.profiles)[0];
  },

  async reviewReportStatus(params: {
    reportId: string;
    action: BackofficeReportAction;
    reviewNotes: string;
  }): Promise<ReportRecord> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const profile = await this.getCurrentProfile();
    if(!profile)throw new Error("กรุณาเข้าสู่ระบบใหม่ บัญชีอาจถูกระงับหรือลบแล้ว");
    const now = new Date().toISOString();

    const idx = cache.reports.findIndex((r) => r.id === params.reportId);
    if (idx === -1) throw new Error("ไม่พบรายการรายงาน");

    const current = cache.reports[idx];
    const { action } = params;
    if (current.status === "closed") throw new Error("ปิดงานแล้ว");
    if (action === "closed" && !canCloseReport(current)) throw new Error("ตรวจผลภาคสนามก่อนปิดงาน");
    if (action === "field_reviewed" && fieldTaskStage(current) !== "submitted") throw new Error("ยังไม่มีผลภาคสนามที่รอตรวจ");

    const changes = {
      status: action === "field_reviewed" ? current.status : action,
      ...(current.status === "acknowledged" && !current.acknowledged_at && {
        acknowledged_at: current.updated_at ?? now,
      }),
      ...(current.status === "submitted" && !current.submitted_at && {
        submitted_at: current.updated_at ?? now,
      }),
      ...(action === "field_reviewed" && {
        reviewed_at: now,
        reviewed_by: profile.id,
        submitted_at: current.submitted_at ?? current.updated_at ?? now,
      }),
      review_notes: params.reviewNotes.trim(),
      updated_at: now,
    } satisfies Partial<ReportRecord>;
    const updatedAt = await updateReportWorkflow(supabase, current, changes);
    const updated = { ...current, ...changes, updated_at: updatedAt ?? now };
    cache.reports[idx] = updated;

    cache.auditLogs.unshift({
      id: crypto.randomUUID(),
      actor_id: profile?.id ?? null,
      actor_name: profile?.full_name ?? "เจ้าหน้าที่ส่วนกลาง",
      action: {
        confirmed: "confirm_report",
        rejected: "reject_report",
        field_reviewed: "review_field_report",
        closed: "close_report",
      }[action],
      target_table: "reports",
      target_id: updated.id,
      details: { status: updated.status, review_notes: params.reviewNotes },
      created_at: now,
    });

    saveLocalCache(cache);
    return enrichReports([updated], cache.zones, cache.stations, cache.profiles)[0];
  },

  // ==========================================================================
  // ACCOUNTS & VERIFICATION STEPPER
  // ==========================================================================
  async getProfiles(options: { strict?: boolean } = {}): Promise<Profile[]> {
    try {
      const profiles = await listAccounts();
      const cache = loadLocalCache();
      cache.profiles = profiles;
      saveLocalCache(cache);
      return profiles;
    } catch (error) {
      if (options.strict) throw error;
      return loadLocalCache().profiles.filter(p=>!p.deleted_at);
    }
  },

  async createAccount(input: CreateAccountInput, draftId: string): Promise<Profile> {
    const actor = await this.getCurrentProfile();
    await requireAccountAdmin(actor?.id);
    const profile = await createAccountRecord(input, draftId);
    const cache = loadLocalCache();
    cache.profiles = [profile, ...cache.profiles.filter(p => p.id !== profile.id)];
    saveLocalCache(cache);
    return profile;
  },

  async approveAccountRole(profileId: string, role: UserRole): Promise<Profile> {
    if (role === "pending_verification") throw new Error("กรุณาเลือกบทบาทสำหรับเปิดใช้งาน");
    const current = await this.getCurrentProfile();
    const actor = await requireAccountAdmin(current?.id);
    const profile = await changeAccountRole(profileId, role, actor);
    const cache = loadLocalCache();
    cache.profiles = cache.profiles.map(p => p.id === profile.id ? profile : p);
    saveLocalCache(cache);
    return profile;
  },

  async adminResetUserPassword(input: { userId: string; newPassword: string; notifyUser?: boolean }) {
    const current = await this.getCurrentProfile();
    const actor = await requireAccountAdmin(current?.id);
    const result = await resetAccountPassword(input);
    const cache = loadLocalCache();
    cache.profiles = cache.profiles.map(p => p.id === result.profile.id ? result.profile : p);
    if (result.notification) cache.userNotifications.unshift(result.notification);
    cache.auditLogs.unshift({ id: crypto.randomUUID(), actor_id: actor.id, actor_name: actor.full_name,
      action: "admin_reset_user_password", target_table: "profiles", target_id: result.profile.id,
      details: { notified: result.notificationStatus === "sent" }, created_at: new Date().toISOString() });
    saveLocalCache(cache);
    return result;
  },

  async getUserNotifications(userId: string): Promise<UserNotification[]> {
    const supabase = createClient();
    const cache = loadLocalCache();

    try {
      const { data, error } = await supabase
        .from("user_notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!error && data && data.length > 0) {
        return data as UserNotification[];
      }
    } catch {
      // fallback to cache
    }

    return (cache.userNotifications ?? []).filter((n) => n.user_id === userId);
  },

  async markNotificationAsRead(notificationId: string): Promise<void> {
    const supabase = createClient();
    const cache = loadLocalCache();

    if (cache.userNotifications) {
      const idx = cache.userNotifications.findIndex((n) => n.id === notificationId);
      if (idx !== -1) {
        cache.userNotifications[idx].is_read = true;
      }
    }
    saveLocalCache(cache);

    try {
      await supabase
        .from("user_notifications")
        .update({ is_read: true })
        .eq("id", notificationId);
    } catch {
      // ignore
    }
  },

  // ==========================================================================
  // NOTIFICATIONS & TELEGRAM DISPATCH
  // ==========================================================================
  async getNotificationRules(): Promise<NotificationRule[]> {
    const supabase = createClient();
    const cache = loadLocalCache();
    try {
      const { data, error } = await supabase
        .from("notification_rules")
        .select("*");
      if (!error && data && data.length > 0) {
        cache.rules = data as NotificationRule[];
        saveLocalCache(cache);
        return cache.rules;
      }
    } catch {
      // fallback
    }
    return cache.rules;
  },

  async updateNotificationRule(
    rule: Partial<NotificationRule> & { risk_level: RiskLevel }
  ): Promise<NotificationRule[]> {
    const supabase = createClient();
    const cache = loadLocalCache();
    const { data, error } = await supabase.from("notification_rules")
      .update({
        channels: rule.channels,
        field_radius_meters: rule.field_radius_meters,
        updated_at: new Date().toISOString(),
      })
      .eq("risk_level", rule.risk_level)
      .select("*")
      .single();
    if (error || !data) throw new Error("บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ");
    cache.rules = cache.rules.map((existing) =>
      existing.risk_level === rule.risk_level ? data as NotificationRule : existing
    );
    saveLocalCache(cache);
    return cache.rules;
  },

  async getNotificationLogs(): Promise<NotificationLog[]> {
    const supabase = createClient();
    const cache = loadLocalCache();
    try {
      const { data, error } = await supabase
        .from("notifications_log")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(30);
      if (!error && data && data.length > 0) {
        cache.notifications = data as NotificationLog[];
        saveLocalCache(cache);
        return cache.notifications;
      }
    } catch {
      // fallback
    }
    return cache.notifications;
  },

  async dispatchTelegramNotification(params: {
    mode?: "automatic";
    reportId?: string | null;
    reportCode: string;
    riskLevel: RiskLevel;
    predictedLabel: string;
    confidence: number;
    locationText: string;
    note?: string;
  }): Promise<NotificationLog | null> {
    let payload: { log?: NotificationLog; message?: string; error?: string; skipped?: boolean };
    try {
      const res = await fetch("/api/notifications/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      payload = await res.json();
    } catch {
      payload = { error: "ไม่สามารถเชื่อมต่อบริการแจ้งเตือนได้" };
    }
    if (payload.skipped) return null;

    const logItem: NotificationLog = payload.log ?? {
      id: crypto.randomUUID(),
      report_id: params.reportId ?? null,
      channel: "telegram",
      recipient: "Telegram Operations Channel",
      message: payload.message ?? `แจ้งเตือน ${params.reportCode}`,
      status: "failed",
      error_message: payload.error ?? null,
      sent_at: new Date().toISOString(),
    };

    const cache = loadLocalCache();
    cache.notifications.unshift(logItem);
    saveLocalCache(cache);
    return logItem;
  },
};
