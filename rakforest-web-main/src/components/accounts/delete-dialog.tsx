"use client";
import { useLanguage } from "@/lib/i18n/language";
import { useRef, useState } from "react";
import Link from "next/link";
import { rakforestRepo } from "@/lib/supabase/repository";
import {
  AccountDialog,
  control,
  primary,
  secondary,
  messageOf,
} from "./account-ui";
type DeleteProps = {
  kind: "profile" | "station" | "zone";
  id: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
};

export default function DeleteDialog(props: DeleteProps) {
  const { t } = useLanguage();
  return (
    <DeleteConfirmation
      {...props}
      render={(form, busy) => (
        <AccountDialog
          title={
            props.kind === "zone"
              ? t("ยืนยันการลบโซนป่า")
              : props.kind === "profile"
                ? t("ลบเจ้าหน้าที่")
                : t("ลบไมค์")
          }
          busy={busy}
          onClose={props.onClose}
        >
          {form}
        </AccountDialog>
      )}
    />
  );
}

export function DeleteConfirmation({
  kind,
  id,
  name,
  onClose,
  onDeleted,
  render,
  onBusyChange,
  cancelLabel = "ยกเลิก",
}: DeleteProps & {
  render: (form: React.ReactNode, busy: boolean) => React.ReactNode;
  cancelLabel?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useLanguage();
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const [blockers, setBlockers] = useState<
    { id: string; name: string; kind: "report" | "zone" | "station" }[]
  >([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    setBlockers([]);
    try {
      const actor = await rakforestRepo.getCurrentProfile();
      if (!actor) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const response = await fetch("/api/directory/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          targetId: id,
          actorId: actor.id,
          password,
        }),
      });
      const result = await response.json();
      if (result.blocked) {
        setBlockers(result.items);
        throw new Error(
          kind === "zone"
            ? "กรุณาย้ายหรือถอดไมค์เหล่านี้ออกจากโซนก่อนลบ"
            : "กรุณาโอนงานและโซนที่รับผิดชอบก่อนลบ",
        );
      }
      if (!response.ok)
        throw new Error(result.message || "ลบไม่สำเร็จ กรุณาลองใหม่");
      if (result.deleted !== true && result.alreadyDeleted !== true)
        throw new Error("เซิร์ฟเวอร์ไม่ยืนยันว่าลบสำเร็จ กรุณาลองใหม่");
      onDeleted();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setPassword("");
      setBusy(false);
      onBusyChange?.(false);
      lock.current = false;
    }
  }
  return render(
    <form onSubmit={submit} className="space-y-4">
      <p>
        {t("ต้องการลบ ")}<strong>{name}</strong>{t(" ออกจากรายการใช้งานหรือไม่? ประวัติรายงานเดิมยังคงอยู่")}
      </p>
      <label className="block text-sm font-semibold">
        {t("รหัสผ่านของคุณ")}
        <input
          className={control + " mt-1"}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={busy}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {t(error)}
        </p>
      )}
      {blockers.length > 0 && (
        <ul>
          {blockers.map((item) => (
            <li key={item.kind + item.id}>
              <Link
                className="underline"
                href={item.kind === "report" ? "/reports/" + item.id : "/zones"}
              >
                {item.kind === "report"
                  ? t("งาน")
                  : item.kind === "station"
                    ? t("ไมค์")
                    : t("โซน")}
                : {item.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={secondary}
          disabled={busy}
          onClick={onClose}
        >
          {t(cancelLabel)}
        </button>
        <button
          className={primary + " bg-red-800"}
          disabled={busy || !password}
        >
          {busy ? t("กำลังยืนยัน…") : t("ยืนยันลบ")}
        </button>
      </div>
    </form>,
    busy,
  );
}
