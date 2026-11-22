"use client";
import { useLanguage } from "@/lib/i18n/language";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileBadge,
  LockKeyhole,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import { rakforestRepo } from "@/lib/supabase/repository";
import { createClient } from "@/lib/supabase/client";
import { positions } from "@/lib/accounts/positions";
import { reserveEmployeeCode } from "@/lib/accounts/service";
import { uploadAccountCard } from "@/lib/accounts/service";
import {
  AccountError,
  normalizeAccount,
  validateCard,
  type ActiveRole,
  type CreateAccountInput,
} from "@/lib/accounts/validation";
import {
  AccountReview,
  RoleOptions,
  primary,
  secondary,
  control,
  panel,
  messageOf,
} from "@/components/accounts/account-ui";
import type { ForestZone, Profile } from "@/types/database.types";

const empty: CreateAccountInput = {
  employee_code: "",
  full_name: "",
  email: "",
  phone: "",
  position: "",
  department: "",
  targetRole: "field_ranger",
  assigned_zone_ids: [],
  password: "",
};
const fields = [
  {
    key: "employee_code",
    label: "รหัสเจ้าหน้าที่",
    placeholder: "เช่น RF-RNG-121",
    required: true,
  },
  { key: "full_name", label: "ชื่อ–นามสกุล", required: true },
  { key: "email", label: "อีเมล", required: true },
  { key: "phone", label: "โทรศัพท์" },

  { key: "department", label: "หน่วยงาน" },
] as const;
const steps = [
  { label: "ข้อมูลเจ้าหน้าที่", icon: UserRoundPlus },
  { label: "บัตรเจ้าหน้าที่", icon: FileBadge },
  { label: "อนุมัติเปิดสิทธิ์", icon: ShieldCheck },
] as const;

export default function NewAccountPage() {
  const { t } = useLanguage();
  const [input, setInput] = useState<CreateAccountInput>(empty),
    [confirm, setConfirm] = useState(""),
    [showPassword, setShowPassword] = useState(false);
  const [zones, setZones] = useState<ForestZone[]>([]),
    [zoneError, setZoneError] = useState(""),
    [zonesLoading, setZonesLoading] = useState(true);
  const [file, setFile] = useState<File>(),
    [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState(""),
    [errorField, setErrorField] = useState("");
  const [busy, setBusy] = useState(false),
    [profile, setProfile] = useState<Profile>(),
    [role, setRole] = useState<ActiveRole>("field_ranger");
  const [allowed, setAllowed] = useState<boolean>(),
    [authError, setAuthError] = useState("");
  const [positionChoice, setPositionChoice] = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeLoading, setCodeLoading] = useState(true);
  const reserved = useRef<Promise<string> | null>(null);
  async function generateCode() {
    setCodeLoading(true);
    setCodeError("");
    try {
      reserved.current ??= reserveEmployeeCode();
      const code = await reserved.current;
      setInput((prev) => ({
        ...prev,
        employee_code: prev.employee_code || code,
      }));
    } catch {
      reserved.current = null;
      setCodeError("สร้างรหัสอัตโนมัติไม่สำเร็จ ลองใหม่หรือระบุรหัสเอง");
    } finally {
      setCodeLoading(false);
    }
  }
  useEffect(() => {
    void generateCode();
  }, []);
  const draftId = useRef("");
  const uploaded = useRef<{ file: File; path: string } | undefined>(undefined);
  const lock = useRef(false);
  const summary = useRef<HTMLHeadingElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const focusStep = useRef(false);
  async function loadZones() {
    setZonesLoading(true);
    setZoneError("");
    try {
      const { data, error } = await createClient()
        .from("forest_zones")
        .select("*")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      setZones(data as ForestZone[]);
    } catch {
      setZoneError("โหลดพื้นที่ไม่สำเร็จ ลองใหม่ หรือบันทึกโดยยังไม่กำหนดพื้นที่");
    } finally {
      setZonesLoading(false);
    }
  }
  useEffect(() => {
    void loadZones();
    rakforestRepo
      .getCurrentProfile()
      .then((p) => setAllowed(p?.role === "super_admin"))
      .catch(() => setAuthError("ตรวจสอบผู้ใช้งานไม่สำเร็จ กรุณาโหลดหน้าใหม่"));
  }, []);
  useEffect(() => {
    if (profile) summary.current?.focus();
  }, [profile]);
  useEffect(() => {
    if (error && !busy)
      document.getElementById(errorField || "account-error")?.focus();
  }, [error, errorField, busy, step]);
  useEffect(() => {
    if (focusStep.current) {
      focusStep.current = false;
      stepHeading.current?.focus();
    }
  }, [step]);

  function goToStep(next: 1 | 2) {
    setError("");
    setErrorField("");
    focusStep.current = true;
    setStep(next);
  }

  function validatedInput() {
    const value = normalizeAccount(input);
    if (value.password !== confirm)
      throw new AccountError("รหัสผ่านยืนยันไม่ตรงกัน", "confirm_password");
    return value;
  }

  function submitStep(e: React.FormEvent) {
    e.preventDefault();
    if (step === 2) {
      void save();
      return;
    }
    try {
      validatedInput();
      goToStep(2);
    } catch (err) {
      showError(err);
      const field = err instanceof AccountError ? err.field : undefined;
      if (field) document.getElementById(field)?.focus();
    }
  }
  function showError(err: unknown) {
    setError(messageOf(err));
    const field = err instanceof AccountError ? err.field : undefined;
    setErrorField(field || "");
    if (field) setStep(field === "id_card" ? 2 : 1);
  }
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setErrorField("");
    try {
      const value = validatedInput();
      if (file) validateCard(file);
      // Check before uploading a private attachment or attempting an insert.
      const { data: existing, error: lookupError } = await createClient()
        .from("profiles")
        .select("id")
        .ilike("employee_code", value.employee_code)
        .limit(1);
      if (lookupError)
        throw new AccountError("ตรวจรหัสเจ้าหน้าที่ไม่สำเร็จ กรุณาลองใหม่");
      if (existing?.some((p) => p.id !== draftId.current))
        throw new AccountError(
          "รหัสเจ้าหน้าที่นี้มีบัญชีแล้ว กรุณาใช้รหัสอื่น หรือเปิดบัญชีเดิม",
          "employee_code",
        );
      if (file && uploaded.current?.file !== file)
        uploaded.current = { file, path: await uploadAccountCard(file) };
      draftId.current ||= crypto.randomUUID();
      const saved = await rakforestRepo.createAccount(
        { ...value, id_card_file_url: file ? uploaded.current?.path : null },
        draftId.current,
      );
      setProfile(saved);
      setRole(saved.requested_role || value.targetRole);
      setInput({ ...input, password: "" });
      setConfirm("");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function approve() {
    if (!profile || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      setProfile(await rakforestRepo.approveAccountRole(profile.id, role));
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  if (authError) return <p role="alert">{t(authError)}</p>;
  if (allowed === undefined) return <p role="status">{t("กำลังตรวจสอบผู้ใช้งาน…")}</p>;
  if (!allowed)
    return (
      <section className={panel}>
        <h1 className="text-xl font-bold">{t("เฉพาะผู้ดูแลระบบ")}</h1>
        <p>{t("กรุณาติดต่อผู้ดูแลเพื่อเพิ่มเจ้าหน้าที่")}</p>
        <Link href="/accounts" className={secondary}>{t("กลับรายการ")}</Link>
      </section>
    );
  const errorBlock = error && (
    <div
      id="account-error"
      tabIndex={-1}
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800"
    >
      <p>{t(error)}</p>
      {errorField === "employee_code" && (
        <Link
          className="mt-2 inline-flex min-h-11 items-center underline"
          href={"/accounts?q=" + encodeURIComponent(input.employee_code.trim())}
        >{t("ค้นหาบัญชีเดิม")}</Link>
      )}
    </div>
  );
  const passwordRules = [
    ["8 ตัวอักษรขึ้นไป", input.password.length >= 8],
    ["ตัวพิมพ์เล็ก", /[a-z]/.test(input.password)],
    ["ตัวพิมพ์ใหญ่", /[A-Z]/.test(input.password)],
    ["ตัวเลข", /[0-9]/.test(input.password)],
    ["รหัสผ่านตรงกัน", Boolean(input.password) && input.password === confirm],
  ] as const;
  const currentStep = profile ? 3 : step;
  const complete = profile && profile.role !== "pending_verification";
  return (
    <div className="mx-auto max-w-3xl space-y-5 text-[#14241B]">
      <Link href="/accounts" className={secondary}>{t("← กลับรายการเจ้าหน้าที่")}</Link>
      <header>
        <h1 ref={summary} tabIndex={-1} className="text-2xl font-bold">
          {profile
            ? profile.role === "pending_verification"
              ? t("ตรวจและอนุมัติบัญชี")
              : t("เปิดใช้งานบัญชีแล้ว")
            : t("ลงทะเบียนเจ้าหน้าที่ใหม่")}
        </h1>
        <p className="mt-1 text-sm text-[#526358]">
          {profile
            ? t("บันทึกข้อมูลเจ้าหน้าที่เรียบร้อยแล้ว")
            : t("กรอกข้อมูล แนบบัตรถ้ามี แล้วตรวจและอนุมัติการเข้าใช้งาน")}
        </p>
      </header>
      <ol aria-label={t("ขั้นตอนลงทะเบียน")} className="grid grid-cols-3 gap-2">
        {steps.map(({ label, icon: Icon }, index) => {
          const number = index + 1;
          const active = currentStep === number;
          const completed = number < currentStep || complete;
          return (
            <li
              key={label}
              aria-current={active && !complete ? "step" : undefined}
              className={`flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 rounded-lg border px-2 py-2 text-xs sm:px-3 sm:text-sm ${active ? "border-[#1B4332] bg-[#1B4332] font-semibold text-white" : "border-[#D4DCD5] bg-white text-[#526358]"}`}
            >
              {completed ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Icon size={16} aria-hidden="true" />
              )}
              <span>
                {number}. {t(label)}
              </span>
            </li>
          );
        })}
      </ol>
      {profile ? (
        <section className={panel}>
          {profile.role === "pending_verification" ? (
            <>
              <AccountReview
                profile={profile}
                role={role}
                onRole={setRole}
                busy={busy}
              />
              {errorBlock}
              <div className="flex flex-wrap justify-end gap-2">
                <Link className={secondary} href="/accounts">{t("อนุมัติภายหลัง")}</Link>
                <button
                  className={primary}
                  disabled={busy}
                  onClick={() => void approve()}
                >
                  {busy ? t("กำลังอนุมัติ…") : t("อนุมัติเปิดใช้งาน")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p role="status">{t("บัญชีของ ")}{profile.full_name} ({profile.employee_code}{t(") พร้อมเข้าใช้งานแล้ว")}</p>
              <Link href="/accounts" className={primary}>{t("กลับรายการเจ้าหน้าที่")}</Link>
            </>
          )}
        </section>
      ) : (
        <form
          onSubmit={submitStep}
          noValidate
          aria-busy={busy}
          className={panel}
        >
          <h2
            ref={stepHeading}
            tabIndex={-1}
            className="border-b border-[#D4DCD5] pb-3 text-lg font-semibold"
          >
            {step === 1
              ? t("ขั้นตอนที่ 1: ข้อมูลเจ้าหน้าที่และพื้นที่รับผิดชอบ")
              : t("ขั้นตอนที่ 2: แนบบัตรเจ้าหน้าที่ (ไม่บังคับ)")}
          </h2>
          <fieldset disabled={busy} className="min-w-0" hidden={step !== 1}>
            <div className="space-y-5">
              {codeLoading && <p role="status">{t("กำลังสร้างรหัสเจ้าหน้าที่…")}</p>}
              {codeError && (
                <div role="alert">
                  <p>{t(codeError)}</p>
                  <button
                    type="button"
                    className={secondary}
                    onClick={() => void generateCode()}
                  >{t("สร้างรหัสอีกครั้ง")}</button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={field.key}
                      className="mb-1 block text-sm font-semibold"
                    >
                      {t(field.label)}
                      {"required" in field ? " *" : t(" (ไม่บังคับ)")}
                    </label>
                    <input
                      id={field.key}
                      className={control}
                      value={input[field.key]}
                      type={
                        field.key === "email"
                          ? "email"
                          : field.key === "phone"
                            ? "tel"
                            : "text"
                      }
                      autoComplete={
                        field.key === "email"
                          ? "email"
                          : field.key === "phone"
                            ? "tel"
                            : field.key === "full_name"
                              ? "name"
                              : "off"
                      }
                      placeholder={
                        "placeholder" in field ? t(field.placeholder) : undefined
                      }
                      aria-required={"required" in field}
                      aria-invalid={errorField === field.key}
                      aria-describedby={
                        errorField === field.key ? "account-error" : undefined
                      }
                      onChange={(e) => {
                        setInput({ ...input, [field.key]: e.target.value });
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">{t("ตำแหน่งหน้าที่")}<select
                    className={control + " mt-1"}
                    value={positionChoice}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPositionChoice(value);
                      const preset = positions.find((p) => p.name === value);
                      setInput((prev) =>
                        preset
                          ? {
                              ...prev,
                              position: preset.name,
                              targetRole: preset.role,
                              department: preset.department,
                            }
                          : { ...prev, position: "" },
                      );
                    }}
                  >
                    <option value="">{t("เลือกตำแหน่ง")}</option>
                    {positions.map((p) => (
                      <option key={p.name} value={p.name}>
                        {t(p.name)}
                      </option>
                    ))}
                    <option value="other">{t("อื่น ๆ ระบุเอง")}</option>
                  </select>
                </label>
                {positionChoice === "other" && (
                  <label className="block text-sm font-semibold">{t("ระบุตำแหน่ง")}<input
                      className={control}
                      value={input.position}
                      onChange={(e) =>
                        setInput({ ...input, position: e.target.value })
                      }
                    />
                  </label>
                )}
                <label className="block text-sm font-semibold">{t("บทบาทที่เสนอ")}<select
                    id="targetRole"
                    className={control + " mt-1"}
                    value={input.targetRole}
                    onChange={(e) =>
                      setInput({
                        ...input,
                        targetRole: e.target.value as ActiveRole,
                      })
                    }
                  >
                    <RoleOptions />
                  </select>
                </label>
              </div>
              <section
                aria-labelledby="password-title"
                className="min-w-0 space-y-3 rounded-lg border border-[#D4DCD5] bg-[#F4F7F4] p-4"
              >
                <h3
                  id="password-title"
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <LockKeyhole size={16} aria-hidden="true" />{t(" รหัสผ่านเข้าใช้งาน")}</h3>
                <p id="password-hint" className="text-sm text-[#526358]">{t("อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข")}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">{t("รหัสผ่าน *")}<input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      className={control + " mt-1"}
                      autoComplete="new-password"
                      value={input.password}
                      aria-required="true"
                      aria-invalid={errorField === "password"}
                      aria-describedby={
                        errorField === "password"
                          ? "password-hint account-error"
                          : "password-hint"
                      }
                      onChange={(e) =>
                        setInput({ ...input, password: e.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm font-semibold">{t("ยืนยันรหัสผ่าน *")}<input
                      id="confirm_password"
                      type={showPassword ? "text" : "password"}
                      className={control + " mt-1"}
                      autoComplete="new-password"
                      value={confirm}
                      aria-required="true"
                      aria-invalid={errorField === "confirm_password"}
                      aria-describedby={
                        errorField === "confirm_password"
                          ? "account-error"
                          : undefined
                      }
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                </div>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                  />{t("แสดงรหัสผ่าน")}</label>
                <ul
                  aria-label={t("เงื่อนไขรหัสผ่าน")}
                  className="flex flex-wrap gap-2 text-xs"
                >
                  {passwordRules.map(([label, met]) => (
                    <li
                      key={label}
                      className={`rounded border px-2 py-1 ${met ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-[#D4DCD5] bg-white text-[#526358]"}`}
                    >
                      <span aria-hidden="true">{met ? "✓ " : "○ "}</span>
                      <span className="sr-only">
                        {met ? t("ผ่าน: ") : t("ยังไม่ผ่าน: ")}
                      </span>
                      {t(label)}
                    </li>
                  ))}
                </ul>
              </section>
              <fieldset className="min-w-0 space-y-2">
                <legend className="text-sm font-semibold">{t("พื้นที่รับผิดชอบ (ไม่บังคับ)")}</legend>
                {zonesLoading ? (
                  <p role="status" className="text-sm">{t("กำลังโหลดพื้นที่…")}</p>
                ) : zoneError ? (
                  <div role="alert" className="text-sm">
                    <p>{t(zoneError)}</p>
                    <button
                      type="button"
                      className={secondary + " mt-2"}
                      onClick={() => void loadZones()}
                    >{t("ลองโหลดพื้นที่ใหม่")}</button>
                  </div>
                ) : zones.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {zones.map((zone) => (
                      <label
                        key={zone.id}
                        className="flex min-h-11 items-center gap-2 rounded-lg border border-[#D4DCD5] p-3 text-sm has-checked:border-[#1B4332] has-checked:bg-[#EAF3ED]"
                      >
                        <input
                          type="checkbox"
                          checked={input.assigned_zone_ids.includes(zone.id)}
                          onChange={(e) =>
                            setInput({
                              ...input,
                              assigned_zone_ids: e.target.checked
                                ? [...input.assigned_zone_ids, zone.id]
                                : input.assigned_zone_ids.filter(
                                    (id) => id !== zone.id,
                                  ),
                            })
                          }
                        />
                        {zone.zone_code} · {zone.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#526358]">{t("ยังไม่มีพื้นที่ให้เลือก")}</p>
                )}
              </fieldset>
            </div>
          </fieldset>
          <fieldset disabled={busy} className="min-w-0" hidden={step !== 2}>
            <div className="space-y-3">
              <p id="card-hint" className="text-sm text-[#526358]">{t("เลือกภาพบัตรเพื่อให้ผู้ดูแลตรวจสอบ หรือบันทึกโดยไม่แนบไฟล์ได้ ใช้ JPEG, PNG หรือ WebP ไม่เกิน 5 MB")}</p>
              <label htmlFor="id_card" className="block text-sm">{t("ภาพบัตรเจ้าหน้าที่")}</label>
              <input
                id="id_card"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className={control}
                aria-describedby={
                  errorField === "id_card"
                    ? "card-hint account-error"
                    : "card-hint"
                }
                aria-invalid={errorField === "id_card"}
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  uploaded.current = undefined;
                }}
              />
              {file && (
                <button
                  type="button"
                  className={secondary}
                  onClick={() => {
                    setFile(undefined);
                    uploaded.current = undefined;
                    const el = document.getElementById(
                      "id_card",
                    ) as HTMLInputElement;
                    el.value = "";
                  }}
                >{t("เอาไฟล์ออก")}</button>
              )}
            </div>
          </fieldset>
          {errorBlock}
          <div className="flex flex-wrap justify-end gap-2">
            {step === 2 && (
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => goToStep(1)}
              >{t("ย้อนกลับ")}</button>
            )}
            <button className={primary + " w-full sm:w-auto"} disabled={busy}>
              {step === 1 ? (
                <span className="inline-flex items-center gap-2">{t("ถัดไป: แนบบัตรเจ้าหน้าที่")}{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              ) : busy ? (
                "กำลังบันทึก…"
              ) : (
                "บันทึกเพื่อรออนุมัติ"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
