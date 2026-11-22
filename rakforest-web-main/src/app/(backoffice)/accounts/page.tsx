"use client";
import { useLanguage } from "@/lib/i18n/language";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DeleteConfirmation } from "@/components/accounts/delete-dialog";
import {
  Settings,
  KeyRound,
  Fingerprint,
  ShieldCheck,
  ShieldOff,
  Trash2,
  ChevronRight,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  updateEmployeeCode,
  requireAccountAdmin,
} from "@/lib/accounts/service";
import { rakforestRepo } from "@/lib/supabase/repository";
import { accountRoles, type ActiveRole } from "@/lib/accounts/validation";
import {
  AccountDialog,
  AccountReview,
  primary,
  secondary,
  control,
  panel,
  messageOf,
  statusOf,
} from "@/components/accounts/account-ui";
import type { Profile } from "@/types/database.types";

type Step = "settings" | "review" | "suspend" | "password" | "code" | "delete";
const titles: Record<Step, string> = {
  settings: "ตั้งค่าบัญชี",
  review: "ตรวจข้อมูลเจ้าหน้าที่",
  suspend: "ยืนยันการระงับสิทธิ์",
  password: "เปลี่ยนรหัสผ่าน",
  code: "แก้ไขรหัสเจ้าหน้าที่",
  delete: "ลบเจ้าหน้าที่",
};

function SettingRow({
  icon: Icon,
  label,
  description,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(label)}
      className={`flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 ${danger ? "text-red-800 hover:bg-red-50" : "text-[#1B4332] hover:bg-[#F0F5F1]"}`}
    >
      <span
        className={`rounded-lg p-2 ${danger ? "bg-red-50" : "bg-[#EAF3ED]"}`}
      >
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{t(label)}</span>
        <span className="block text-xs leading-relaxed text-[#526358]">
          {t(description)}
        </span>
      </span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function roleLabel(profile: Profile) {
  return profile.role in accountRoles
    ? accountRoles[profile.role as ActiveRole]
    : profile.requested_role
      ? accountRoles[profile.requested_role]
      : "ยังไม่ได้กำหนดบทบาท";
}
function StatusBadge({ profile }: { profile: Profile }) {
  const { t } = useLanguage();
  const tone =
    profile.role === "pending_verification"
      ? "bg-amber-50 text-amber-900"
      : profile.role === "suspended"
        ? "bg-red-50 text-red-900"
        : "bg-emerald-50 text-emerald-900";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {t(statusOf(profile))}
    </span>
  );
}

export default function AccountsPage() {
  const { t, language } = useLanguage();
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ทั้งหมด"),
    [feedback, setFeedback] = useState<{text: string; name?: string}>({text:""});
  const [selection, setSelection] = useState<{ id: string; kind: Step }>(),
    [role, setRole] = useState<ActiveRole>("field_ranger");
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState("");
  const lock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const profile = profiles.find((item) => item.id === selection?.id);
  const action =
    profile && selection ? { profile, kind: selection.kind } : undefined;
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [notify, setNotify] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setProfiles(await rakforestRepo.getProfiles({ strict: true }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") || "");
    rakforestRepo
      .getCurrentProfile()
      .then((p) => setIsAdmin(p?.role === "super_admin"))
      .catch(() => setIsAdmin(false));
  }, [load]);
  const open = useCallback((profile: Profile, kind: Step) => {
    setSelection({ id: profile.id, kind });
    setFeedback({text:""});
    setEmployeeCode(profile.employee_code || "");
    setRole(
      profile.requested_role ??
        (profile.role in accountRoles
          ? (profile.role as ActiveRole)
          : "field_ranger"),
    );
    setActionError("");
    setPassword("");
    setShowPassword(false);
    setNotify(true);
  }, []);
  useEffect(() => {
    if (loading || error || !isAdmin) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("review");
    const match = profiles.find((p) => p.id === id);
    if (match) {
      open(match, "review");
      params.delete("review");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (params.size ? "?" + params.toString() : ""),
      );
    }
  }, [loading, error, profiles, isAdmin, open]);
  async function save() {
    if (
      !action ||
      action.kind === "settings" ||
      action.kind === "delete" ||
      lock.current
    )
      return;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      let updated: Profile;
      let text: string;
      if (action.kind === "code") {
        const actor = await rakforestRepo.getCurrentProfile();
        await requireAccountAdmin(actor?.id);
        updated = await updateEmployeeCode(action.profile.id, employeeCode);
        text = "แก้ไขรหัสเจ้าหน้าที่แล้ว";
      } else if (action.kind === "password") {
        const result = await rakforestRepo.adminResetUserPassword({
          userId: action.profile.id,
          newPassword: password,
          notifyUser: notify,
        });
        updated = result.profile;
        text =
          result.notificationStatus === "failed"
            ? "เปลี่ยนรหัสผ่านแล้ว แต่ส่งการแจ้งเตือนในระบบไม่สำเร็จ"
            : result.notificationStatus === "sent"
              ? "เปลี่ยนรหัสผ่านและส่งการแจ้งเตือนในระบบแล้ว"
              : "เปลี่ยนรหัสผ่านแล้ว";
      } else {
        updated = await rakforestRepo.approveAccountRole(
          action.profile.id,
          action.kind === "suspend" ? "suspended" : role,
        );
        text = action.kind === "suspend" ? "ระงับสิทธิ์แล้ว" : "อนุมัติเปิดใช้งานแล้ว";
      }
      setProfiles((list) =>
        list.map((p) => (p.id === updated.id ? updated : p)),
      );
      setFeedback({text, name: updated.full_name});
      setPassword("");
      setSelection({ id: updated.id, kind: "settings" });
    } catch (err) {
      setActionError(messageOf(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const search = query.trim().toLocaleLowerCase();
  const visible = profiles.filter(
    (p) =>
      (filter === "ทั้งหมด" || statusOf(p) === filter) &&
      [p.full_name, p.employee_code, p.email].some((v) =>
        v?.toLocaleLowerCase().includes(search),
      ),
  );
  return (
    <div className="space-y-5 text-[#14241B]">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("จัดการเจ้าหน้าที่")}</h1>
          <p className="mt-1 text-sm text-[#526358]">{t("ค้นหาบัญชี ตรวจข้อมูล และอนุมัติการเข้าใช้งาน")}</p>
        </div>
        {isAdmin && (
          <Link href="/accounts/new" className={primary}>{t("เพิ่มเจ้าหน้าที่")}</Link>
        )}
      </header>
      {feedback.text && !action && (
        <p
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm"
        >
          {t(feedback.text)}{feedback.name && ` • ${feedback.name}`}
        </p>
      )}
      <section className={panel}>
        <label className="block text-sm font-semibold">{t("ค้นหาเจ้าหน้าที่")}<input
            ref={searchRef}
            type="search"
            className={control + " mt-1"}
            placeholder={t("ชื่อ รหัสเจ้าหน้าที่ หรืออีเมล")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2" aria-label={t("กรองสถานะ")}>
          {["ทั้งหมด", "รออนุมัติ", "ใช้งานอยู่", "ระงับสิทธิ์"].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={filter === value ? primary : secondary}
            >
              {value === "ระงับสิทธิ์" && language === "en" ? "Suspended" : t(value)} (
              {value === "ทั้งหมด"
                ? profiles.length
                : profiles.filter((p) => statusOf(p) === value).length}
              )
            </button>
          ))}
        </div>
      </section>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3"
        >
          <p>{t(error)}</p>
          <button
            type="button"
            className={secondary}
            onClick={() => void load()}
          >{t("ลองโหลดใหม่")}</button>
        </div>
      )}
      {loading ? (
        <p role="status">{t("กำลังโหลดเจ้าหน้าที่…")}</p>
      ) : (
        !error && (
          <section
            aria-label={t("รายการเจ้าหน้าที่")}
            className="rounded-xl border border-[#D4DCD5] bg-white"
          >
            {!visible.length ? (
              <p className="p-6 text-center text-sm text-[#526358]">
                {profiles.length ? t("ไม่พบเจ้าหน้าที่ตามเงื่อนไข") : t("ยังไม่มีบัญชีเจ้าหน้าที่")}
              </p>
            ) : (
              <>
                <p className="border-b border-[#D4DCD5] px-4 py-3 text-sm text-[#526358]">{t("พบ ")}{visible.length}{t(" บัญชี")}</p>
                <ul className="divide-y divide-[#D4DCD5]">
                  {visible.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold">{p.full_name}</h2>
                          <StatusBadge profile={p} />
                        </div>
                        <p className="break-words text-sm text-[#526358]">
                          {p.employee_code} · {t(roleLabel(p))}
                        </p>
                        <p className="break-words text-sm text-[#526358]">
                          {p.department || p.email || t("ไม่ได้ระบุหน่วยงาน")}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex flex-wrap gap-2">
                          {(p.role === "pending_verification" ||
                            p.role === "suspended") && (
                            <button
                              type="button"
                              className={primary}
                              onClick={() => open(p, "review")}
                            >
                              {p.role === "suspended"
                                ? t("คืนสิทธิ์")
                                : t("ตรวจสอบและอนุมัติ")}
                            </button>
                          )}
                          <button
                            type="button"
                            className={secondary + " gap-2"}
                            onClick={() => open(p, "settings")}
                          >
                            <Settings size={16} aria-hidden="true" />{t("ตั้งค่าบัญชี")}</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )
      )}
      {action && (
        <AccountDialog
          title={titles[action.kind]}
          busy={busy}
          fallbackFocus={searchRef}
          onClose={() => {
            setPassword("");
            setSelection(undefined);
          }}
        >
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#D8E5DB] bg-[#F3F8F4] p-3.5">
            <span className="rounded-lg bg-[#DDECE2] p-2.5 text-[#1B4332]">
              <UserRound size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-words font-semibold">
                  {action.profile.full_name}
                </p>
                <StatusBadge profile={action.profile} />
              </div>
              <p className="mt-1 break-words text-sm text-[#526358]">
                {action.profile.employee_code} · {t(roleLabel(action.profile))}
              </p>
            </div>
          </div>
          {action.kind === "settings" ? (
            <div className="space-y-4">
              {feedback.text && (
                <p
                  role="status"
                  className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
                >
                  {t(feedback.text)}{feedback.name && ` • ${feedback.name}`}
                </p>
              )}
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("ข้อมูลบัญชีและรหัสผ่าน")}</h3>
                <div className="divide-y divide-[#D4DCD5] overflow-hidden rounded-xl border border-[#D4DCD5]">
                  <SettingRow
                    icon={KeyRound}
                    label={t("เปลี่ยนรหัสผ่าน")}
                    description={t("กำหนดรหัสผ่านใหม่สำหรับเข้าสู่ระบบ")}
                    onClick={() => open(action.profile, "password")}
                  />
                  <SettingRow
                    icon={Fingerprint}
                    label={t("แก้ไขรหัสเจ้าหน้าที่")}
                    description={t("แก้รหัสที่ใช้ค้นหาและอ้างอิงเจ้าหน้าที่")}
                    onClick={() => open(action.profile, "code")}
                  />
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t("สิทธิ์และการลบบัญชี")}</h3>
                <div className="divide-y divide-[#D4DCD5] overflow-hidden rounded-xl border border-[#D4DCD5]">
                  {(action.profile.role === "pending_verification" ||
                    action.profile.role === "suspended") && (
                    <SettingRow
                      icon={ShieldCheck}
                      label={
                        action.profile.role === "suspended"
                          ? t("คืนสิทธิ์")
                          : t("ตรวจสอบและอนุมัติ")
                      }
                      description={t("ตรวจข้อมูลและเลือกบทบาทก่อนเปิดใช้งาน")}
                      onClick={() => open(action.profile, "review")}
                    />
                  )}
                  {action.profile.role !== "super_admin" &&
                    action.profile.role !== "suspended" && (
                      <SettingRow
                        icon={ShieldOff}
                        label={t("ระงับสิทธิ์")}
                        description={t("ปิดการเข้าใช้งานชั่วคราว")}
                        onClick={() => open(action.profile, "suspend")}
                      />
                    )}
                  <SettingRow
                    icon={Trash2}
                    label={t("ลบเจ้าหน้าที่")}
                    description={t("นำบัญชีออกจากการใช้งานและเก็บประวัติรายงาน")}
                    danger
                    onClick={() => open(action.profile, "delete")}
                  />
                </div>
              </section>
            </div>
          ) : action.kind === "delete" ? (
            <DeleteConfirmation
              kind="profile"
              id={action.profile.id}
              name={`${action.profile.full_name} (${action.profile.employee_code})`}
              cancelLabel={t("ย้อนกลับ")}
              onBusyChange={setBusy}
              onClose={() => open(action.profile, "settings")}
              onDeleted={() => {
                setProfiles((list) =>
                  list.filter((p) => p.id !== action.profile.id),
                );
                setSelection(undefined);
                setFeedback({text:"ลบเจ้าหน้าที่ออกจากรายการใช้งานแล้ว ประวัติเดิมยังคงอยู่"});
              }}
              render={(form) => form}
            />
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              aria-busy={busy}
            >
              {action.kind === "code" ? (
                <label className="block text-sm font-semibold">{t("รหัสเจ้าหน้าที่")}<input
                    className={control}
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    required
                    disabled={busy}
                  />
                </label>
              ) : action.kind === "review" ? (
                <AccountReview
                  profile={action.profile}
                  role={role}
                  onRole={setRole}
                  busy={busy}
                />
              ) : action.kind === "suspend" ? (
                <p>{t("ระงับสิทธิ์ของ ")}<strong>{action.profile.full_name}</strong> (
                  {action.profile.employee_code}{t(")? บัญชีจะเข้าใช้งานไม่ได้จนกว่าจะคืนสิทธิ์")}</p>
              ) : (
                <>
                  <label className="block text-sm font-semibold">{t("รหัสผ่านใหม่")}<input
                      autoComplete="new-password"
                      type={showPassword ? "text" : "password"}
                      required
                      className={control + " mt-1"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <p className="text-sm text-[#526358]">{t("อย่างน้อย 8 ตัวอักษร มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ และตัวเลข")}</p>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={(e) => setShowPassword(e.target.checked)}
                    />{t("แสดงรหัสผ่าน")}</label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={notify}
                      onChange={(e) => setNotify(e.target.checked)}
                    />{t("แจ้งเจ้าหน้าที่ผ่านการแจ้งเตือนในระบบ")}</label>
                </>
              )}
              {actionError && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
                >
                  {t(actionError)}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className={secondary}
                  type="button"
                  disabled={busy}
                  onClick={() => open(action.profile, "settings")}
                >{t("ย้อนกลับ")}</button>
                <button className={primary} disabled={busy}>
                  {busy
                    ? t("กำลังบันทึก…")
                    : action.kind === "code"
                      ? t("บันทึกรหัสเจ้าหน้าที่")
                      : action.kind === "password"
                        ? t("บันทึกรหัสผ่าน")
                        : action.kind === "suspend"
                          ? t("ยืนยันระงับสิทธิ์")
                          : t("อนุมัติเปิดใช้งาน")}
                </button>
              </div>
            </form>
          )}
        </AccountDialog>
      )}
    </div>
  );
}
