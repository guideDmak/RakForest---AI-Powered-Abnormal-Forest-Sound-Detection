"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { accountRoles, type ActiveRole } from "@/lib/accounts/validation";
import { accountCardUrl } from "@/lib/accounts/service";
import type { Profile } from "@/types/database.types";

export const primary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1B4332] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#285B43]";
export const secondary =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#B8C7BC] bg-white px-4 py-2 text-sm font-semibold text-[#1B4332] disabled:opacity-50 hover:bg-[#F0F5F1]";
export const control =
  "block min-h-11 w-full min-w-0 rounded-lg border border-[#B8C7BC] bg-white px-3 py-2 text-base text-[#14241B] focus:outline-2 focus:outline-offset-2 focus:outline-[#2D6A4F]";
export const panel =
  "rounded-xl border border-[#D4DCD5] bg-white p-4 sm:p-6 space-y-4";
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองใหม่";
}
export function statusOf(profile: Profile): string {
  return profile.role === "suspended"
    ? "ระงับสิทธิ์"
    : profile.role === "pending_verification"
      ? "รออนุมัติ"
      : "ใช้งานอยู่";
}
export function RoleOptions() {
  return (
    <>
      {Object.entries(accountRoles).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </>
  );
}
export function AccountDialog({
  title,
  busy,
  onClose,
  children,
  fallbackFocus,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
  fallbackFocus?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (
        previous instanceof HTMLElement &&
        previous !== document.body &&
        previous.isConnected
      ) {
        previous.focus();
      } else {
        fallbackFocus?.current?.focus();
      }
    };
  }, [fallbackFocus]);
  useEffect(() => {
    closeRef.current?.focus();
    if (ref.current) ref.current.scrollTop = 0;
  }, [title]);
  return (
    <dialog
      ref={ref}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
          ) ?? [],
        ).filter((el) => el.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-xl border border-[#D4DCD5] bg-white p-5 text-[#14241B] shadow-xl backdrop:bg-black/50"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <button
          ref={closeRef}
          autoFocus
          type="button"
          className={secondary}
          disabled={busy}
          onClick={onClose}
        >
          ปิด
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function AccountReview({
  profile,
  role,
  onRole,
  busy,
}: {
  profile: Profile;
  role: ActiveRole;
  onRole: (role: ActiveRole) => void;
  busy: boolean;
}) {
  const [cardUrl, setCardUrl] = useState("");
  const [cardError, setCardError] = useState("");
  const [loading, setLoading] = useState(false);
  async function openCard() {
    setLoading(true);
    setCardError("");
    try {
      setCardUrl(await accountCardUrl(profile.id_card_file_url!));
    } catch (error) {
      setCardError(messageOf(error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm [&_dd]:break-words [&_dd]:min-w-0">
        <dt>ชื่อ</dt>
        <dd className="font-semibold">{profile.full_name}</dd>
        <dt>รหัส</dt>
        <dd>{profile.employee_code}</dd>
        <dt>อีเมล</dt>
        <dd>{profile.email || "ไม่ได้ระบุ"}</dd>
        <dt>โทรศัพท์</dt>
        <dd>{profile.phone || "ไม่ได้ระบุ"}</dd>
        <dt>ตำแหน่ง</dt>
        <dd>{profile.position || "ไม่ได้ระบุ"}</dd>
        <dt>หน่วยงาน</dt>
        <dd>{profile.department || "ไม่ได้ระบุ"}</dd>
        <dt>สถานะ</dt>
        <dd>{statusOf(profile)}</dd>
      </dl>
      {profile.id_card_file_url ? (
        <div className="space-y-2">
          <button
            type="button"
            className={secondary}
            disabled={loading}
            onClick={openCard}
          >
            {loading ? "กำลังเปิดบัตร…" : "ดูบัตรเจ้าหน้าที่"}
          </button>
          {cardError && (
            <p role="alert" className="text-sm text-red-800">
              {cardError}
            </p>
          )}
          {cardUrl && (
            <a
              href={cardUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-sm underline"
            >
              เปิดภาพบัตร (ลิงก์หมดอายุใน 5 นาที)
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm text-[#526358]">ไม่ได้แนบบัตรเจ้าหน้าที่</p>
      )}
      <label className="block text-sm font-semibold">
        บทบาทที่จะเปิดใช้งาน
        <select
          className={control + " mt-1"}
          value={role}
          disabled={busy}
          onChange={(e) => onRole(e.target.value as ActiveRole)}
        >
          <RoleOptions />
        </select>
      </label>
      <p className="text-sm text-[#526358]">
        ตรวจข้อมูลเจ้าหน้าที่ให้ถูกต้องก่อนอนุมัติ บัญชีจะเข้าใช้งานได้ตามบทบาทที่เลือก
      </p>
    </div>
  );
}
