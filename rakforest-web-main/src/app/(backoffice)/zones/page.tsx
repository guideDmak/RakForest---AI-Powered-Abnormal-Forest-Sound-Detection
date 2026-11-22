"use client";
import { useLanguage } from "@/lib/i18n/language";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  MapPin,
  Trees,
  Radio,
  Map as MapIcon,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { RiskBadge } from "@/components/reports/RiskBadge";
import { rakforestRepo } from "@/lib/supabase/repository";
import {
  validatePolygon,
  openPolygon,
  calculatePolygonAreaRai,
  pointWithinBoundary,
  type PolygonPoint,
} from "@/lib/utils/geo";
import {
  control,
  primary,
  secondary,
  panel,
  messageOf,
} from "@/components/accounts/account-ui";
import DeleteDialog from "@/components/accounts/delete-dialog";
import type {
  ForestZone,
  Profile,
  SensorStation,
  RiskLevel,
  StationStatus,
} from "@/types/database.types";
const RiskZoneMap = dynamic(() => import("@/components/map/RiskZoneMap"), {
  ssr: false,
});
type DirectoryTab = "zones" | "stations";
const directoryTabs = ["zones", "stations"] as const;
const compactCard =
  "flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[#D4DCD5] bg-white p-3";

type Mode = "view" | "polygon" | "station";
const blankZone = {
  code: "",
  name: "",
  province: "",
  district: "",
  risk: "yellow" as RiskLevel,
  officer: "",
  description: "",
};
const blankStation = {
  code: "",
  name: "",
  zone: "",
  lat: "",
  lng: "",
  radius: "350",
  status: "online" as StationStatus,
  notes: "",
};
export default function ZonesPage() {
  const { t } = useLanguage();
  const [zones, setZones] = useState<ForestZone[]>([]),
    [stations, setStations] = useState<SensorStation[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]);
  const [mode, setMode] = useState<Mode>("view"),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const lock = useRef(false);
  const [tab, setTab] = useState<DirectoryTab>("zones");
  const [queries, setQueries] = useState({ zones: "", stations: "" });
  const mapSection = useRef<HTMLElement>(null);
  const formSection = useRef<HTMLElement>(null);
  const zoneTab = useRef<HTMLButtonElement>(null);
  const stationTab = useRef<HTMLButtonElement>(null);
  const tabRefs = { zones: zoneTab, stations: stationTab };

  const [zone, setZone] = useState(blankZone),
    [station, setStation] = useState(blankStation);
  const [editingZone, setEditingZone] = useState<string>(),
    [editingStation, setEditingStation] = useState<string>();
  const [points, setPoints] = useState<PolygonPoint[]>([]),
    [selectedPoint, setSelectedPoint] = useState<number | null>(null),
    [finished, setFinished] = useState(false),
    [acceptOutside, setAcceptOutside] = useState(false);
  const [deleting, setDeleting] = useState<SensorStation>(),
    [deletingZone, setDeletingZone] = useState<ForestZone>(),
    [admin, setAdmin] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [z, s, p] = await Promise.all([
        rakforestRepo.getZones(),
        rakforestRepo.getStations(),
        rakforestRepo.getProfiles({ strict: true }),
      ]);
      setZones(z);
      setStations(s);
      setProfiles(
        p.filter(
          (p) => p.role !== "suspended" && p.role !== "pending_verification",
        ),
      );
    } catch (e) {
      setLoadError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    rakforestRepo
      .getCurrentProfile()
      .then((p) => setAdmin(p?.role === "super_admin"))
      .catch(() => setAdmin(false));
  }, [load]);
  function jumpTo(target: HTMLElement | null) {
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function focusEditor(target: "map" | "form") {
    requestAnimationFrame(() => {
      const section =
        target === "map" ? mapSection.current : formSection.current;
      if (
        target === "form" ||
        window.matchMedia("(max-width: 1023px)").matches
      ) {
        jumpTo(section);
      } else {
        section?.focus({ preventScroll: true });
      }
    });
  }
  function cancel() {
    if (mode !== "view")
      requestAnimationFrame(() => tabRefs[tab].current?.focus());
    setMode("view");
    setPoints([]);
    setSelectedPoint(null);
    setFinished(false);
    setError("");
    setAcceptOutside(false);
  }
  function startZone(item?: ForestZone) {
    setEditingZone(item?.id);
    setZone(
      item
        ? {
            code: item.zone_code || "",
            name: item.name,
            province: item.province || "",
            district: item.district || "",
            risk: item.current_risk_level,
            officer: item.responsible_officer_id || "",
            description: item.description || "",
          }
        : blankZone,
    );
    setPoints(item ? openPolygon(item.polygon_coords) : []);
    setSelectedPoint(null);
    setFinished(false);
    setAcceptOutside(false);
    setError("");
    setTab("zones");
    setMode("polygon");
    focusEditor("map");
  }
  function startStation(item?: SensorStation) {
    setEditingStation(item?.id);
    setStation(
      item
        ? {
            code: item.station_code,
            name: item.name,
            zone: item.zone_id ?? "",
            lat: String(item.lat),
            lng: String(item.lng),
            radius: String(item.radius_meters),
            status: item.status,
            notes: item.notes || "",
          }
        : blankStation,
    );
    setError("");
    setTab("stations");
    setMode("station");
    focusEditor("form");
  }
  function changePoints(next: PolygonPoint[]) {
    if (lock.current) return;
    setPoints(next);
    setFinished(false);
    setAcceptOutside(false);
    setError("");
  }
  let geometryError = "";
  let area: number | null = null;
  try {
    area = calculatePolygonAreaRai(validatePolygon(points));
  } catch (e) {
    geometryError = messageOf(e);
  }
  const outside =
    editingZone && area !== null
      ? stations.filter(
          (s) =>
            s.zone_id === editingZone &&
            !pointWithinBoundary([s.lng, s.lat], points),
        )
      : [];
  async function saveZone(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!finished) throw new Error("กรุณากดจบการวาดก่อนบันทึก");
      const polygon = validatePolygon(points);
      if (outside.length && !acceptOutside)
        throw new Error("กรุณาตรวจรายชื่อไมค์ที่อยู่นอกขอบเขตและยืนยันก่อนบันทึก");
      const saved = await rakforestRepo.saveZone({
        id: editingZone,
        zone_code: zone.code,
        name: zone.name,
        province: zone.province,
        district: zone.district,
        current_risk_level: zone.risk,
        responsible_officer_id: zone.officer || null,
        description: zone.description,
        polygon_coords: polygon,
      });
      setZones((list) => [saved, ...list.filter((z) => z.id !== saved.id)]);
      cancel();
      setFeedback("บันทึกขอบเขตโซนแล้ว");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveStation(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!station.lat.trim() || !station.lng.trim() || !station.radius.trim())
        throw new Error("กรุณาระบุพิกัดและรัศมีไมค์");
      const saved = await rakforestRepo.saveStation({
        id: editingStation,
        station_code: station.code,
        name: station.name,
        zone_id: station.zone || null,
        lat: Number(station.lat),
        lng: Number(station.lng),
        radius_meters: Number(station.radius),
        status: station.status,
        notes: station.notes,
      });
      setStations((list) => [saved, ...list.filter((s) => s.id !== saved.id)]);
      cancel();
      setFeedback("บันทึกไมค์แล้ว");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const query = queries[tab].trim().toLocaleLowerCase();
  const matches = (name: string, code?: string | null) =>
    [name, code].some((value) => value?.toLocaleLowerCase().includes(query));
  const visibleZones =
    tab === "zones"
      ? zones.filter((item) => matches(item.name, item.zone_code))
      : [];
  const visibleStations =
    tab === "stations"
      ? stations.filter((item) => matches(item.name, item.station_code))
      : [];

  return (
    <div className="space-y-4 text-[#14241B]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("จัดการโซนป่าและเสาไมค์")}</h1>
          <p className="mt-1 text-sm text-[#526358]">{t("กำหนดขอบเขตพื้นที่ และจัดการจุดติดตั้งไมค์")}</p>
        </div>
        <nav aria-label={t("โหมดแผนที่")} className="flex flex-wrap gap-2">
          {mode !== "view" && (
            <button
              className={secondary + " gap-2"}
              disabled={busy}
              onClick={cancel}
            >
              <MapIcon size={16} aria-hidden="true" />{t(" ดูแผนที่")}</button>
          )}
          <button
            className={(mode === "station" ? secondary : primary) + " gap-2"}
            disabled={busy || loading}
            onClick={() => startZone()}
          >
            <Trees size={16} aria-hidden="true" />{t(" วาดโซนใหม่")}</button>
          <button
            className={(mode === "station" ? primary : secondary) + " gap-2"}
            disabled={busy || loading}
            onClick={() => startStation()}
          >
            <Radio size={16} aria-hidden="true" />{t(" เพิ่มไมค์")}</button>
        </nav>
      </header>
      {feedback && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3">
          {t(feedback)}
        </p>
      )}
      {loadError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3">
          <p>{t(loadError)}</p>
          <button className={secondary} onClick={() => void load()}>{t("ลองโหลดใหม่")}</button>
        </div>
      )}
      {loading && <p role="status">{t("กำลังโหลดข้อมูล…")}</p>}
      <div
        className={
          mode === "view"
            ? ""
            : "grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        }
      >
        <section
          ref={mapSection}
          tabIndex={-1}
          aria-label={t("แผนที่โซนและเสาไมค์")}
          className="min-w-0 scroll-mt-20 space-y-2"
        >
          {mode !== "view" && (
            <button
              type="button"
              className={secondary + " gap-2 lg:hidden"}
              onClick={() => jumpTo(formSection.current)}
            >
              <ArrowDown size={16} aria-hidden="true" />{t(" ไปที่ฟอร์ม")}</button>
          )}
          {mode === "polygon" && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm">
                {finished
                  ? t("วาดเสร็จแล้ว ตรวจข้อมูลก่อนบันทึก หรือลากจุดเพื่อแก้ไข")
                  : t("แตะแผนที่เพิ่มจุด ลากหมุดเพื่อแก้ตำแหน่ง หรือเลือกจุดแล้วกดลบ")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className={secondary}
                  disabled={busy || !points.length}
                  onClick={() => {
                    changePoints(points.slice(0, -1));
                    setSelectedPoint(null);
                  }}
                >{t("ย้อนจุด")}</button>
                <button
                  className={secondary}
                  disabled={busy || !points.length}
                  onClick={() => {
                    changePoints([]);
                    setSelectedPoint(null);
                  }}
                >{t("ล้างทั้งหมด")}</button>
                <button
                  className={secondary}
                  disabled={busy || selectedPoint === null}
                  onClick={() => {
                    changePoints(points.filter((_, i) => i !== selectedPoint));
                    setSelectedPoint(null);
                  }}
                >{t("ลบจุดที่เลือก")}</button>
                <button
                  className={primary}
                  disabled={busy || !!geometryError}
                  onClick={() => {
                    setFinished(true);
                    setError("");
                    focusEditor("form");
                  }}
                >{t("จบการวาด")}</button>
              </div>
              <p className="text-sm" role="status">
                {points.length}{t(" จุด ·")}{" "}
                {t(geometryError) || (t("พื้นที่ ") + area?.toLocaleString() + t(" ไร่"))}
              </p>
            </div>
          )}
          {mode === "station" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm">{t("แตะแผนที่เพื่อวางไมค์ หรือกรอกพิกัดในฟอร์ม")}</p>
          )}
          <RiskZoneMap
            zones={zones}
            stations={stations}
            editMode={busy ? "view" : mode}
            selectedZoneId={editingZone}
            onSelectStation={(id) => {
              const s = stations.find((s) => s.id === id);
              if (s) startStation(s);
            }}
            onMapClickCoordinates={(p) => {
              if (busy) return;
              if (mode === "polygon" && !finished) changePoints([...points, p]);
              if (mode === "station")
                setStation({
                  ...station,
                  lng: String(p[0]),
                  lat: String(p[1]),
                });
            }}
            draftPolygonCoords={
              mode === "polygon" &&
              points.every(
                ([lng, lat]) =>
                  Number.isFinite(lng) &&
                  Number.isFinite(lat) &&
                  Math.abs(lng) <= 180 &&
                  Math.abs(lat) <= 90,
              )
                ? points
                : undefined
            }
            onMovePolygonPoint={(index, p) =>
              changePoints(points.map((old, i) => (i === index ? p : old)))
            }
            onSelectPolygonPoint={setSelectedPoint}
            selectedPolygonPoint={selectedPoint}
            draftPointCoords={
              mode === "station" &&
              station.lng.trim() &&
              station.lat.trim() &&
              Number.isFinite(Number(station.lng)) &&
              Number.isFinite(Number(station.lat)) &&
              Math.abs(Number(station.lng)) <= 180 &&
              Math.abs(Number(station.lat)) <= 90
                ? [Number(station.lng), Number(station.lat)]
                : null
            }
            draftRadiusMeters={
              Number.isFinite(Number(station.radius))
                ? Math.max(0, Math.min(100000, Number(station.radius)))
                : 350
            }
            heightClass={
              mode === "view"
                ? "h-[300px] lg:h-[400px]"
                : "h-[320px] lg:h-[440px]"
            }
          />
          {mode === "polygon" && points.length > 0 && (
            <details className={panel}>
              <summary className="cursor-pointer">{t("แก้พิกัดจุดด้วยตัวเลข (")}{points.length}{t(" จุด)")}</summary>
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {points.map((p, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[auto_1fr_1fr] items-center gap-2"
                  >
                    <button
                      className={secondary}
                      aria-pressed={selectedPoint === i}
                      onClick={() => setSelectedPoint(i)}
                    >{t("จุด ")}{i + 1}
                    </button>
                    <label className="text-xs">{t("ลองจิจูด")}<input
                        aria-label={(t("ลองจิจูดจุด ") + (i + 1))}
                        type="number"
                        step="any"
                        className={control}
                        value={p[0]}
                        onChange={(e) =>
                          changePoints(
                            points.map((old, j) =>
                              j === i ? [Number(e.target.value), old[1]] : old,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="text-xs">{t("ละติจูด")}<input
                        aria-label={(t("ละติจูดจุด ") + (i + 1))}
                        type="number"
                        step="any"
                        className={control}
                        value={p[1]}
                        onChange={(e) =>
                          changePoints(
                            points.map((old, j) =>
                              j === i ? [old[0], Number(e.target.value)] : old,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
        {mode !== "view" && (
          <section
            ref={formSection}
            tabIndex={-1}
            aria-label={t("ฟอร์มจัดการโซนและเสาไมค์")}
            className="min-w-0 scroll-mt-20 space-y-3"
          >
            <button
              type="button"
              className={secondary + " gap-2 lg:hidden"}
              onClick={() => jumpTo(mapSection.current)}
            >
              <ArrowUp size={16} aria-hidden="true" />{t(" กลับไปที่แผนที่")}</button>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
                {t(error)}
              </p>
            )}
            {mode === "polygon" ? (
              <form onSubmit={saveZone} className={panel}>
                <h2 className="text-lg font-bold">
                  {editingZone ? t("แก้ไขขอบเขตโซน") : t("เพิ่มโซนป่า")}
                </h2>
                <fieldset
                  disabled={busy}
                  className="grid min-w-0 gap-3 sm:grid-cols-2"
                >
                  {(
                    [
                      { key: "code", label: "รหัสโซน" },
                      { key: "name", label: "ชื่อโซนป่า" },
                      { key: "province", label: "จังหวัด" },
                      { key: "district", label: "อำเภอ" },
                    ] as const
                  ).map((f) => (
                    <label key={f.key} className="block text-sm font-semibold">
                      {t(f.label)}
                      <input
                        className={control + " mt-1"}
                        value={zone[f.key]}
                        required={f.key === "code" || f.key === "name"}
                        onChange={(e) =>
                          setZone({ ...zone, [f.key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <label className="block text-sm font-semibold">{t("ความเสี่ยง")}<select
                      className={control}
                      value={zone.risk}
                      onChange={(e) =>
                        setZone({ ...zone, risk: e.target.value as RiskLevel })
                      }
                    >
                      <option value="green">{t("ปกติ")}</option>
                      <option value="yellow">{t("เฝ้าระวัง")}</option>
                      <option value="red">{t("เสี่ยงสูง")}</option>
                    </select>
                  </label>
                  <label className="block text-sm font-semibold">{t("ผู้รับผิดชอบ")}<select
                      className={control}
                      value={zone.officer}
                      onChange={(e) =>
                        setZone({ ...zone, officer: e.target.value })
                      }
                    >
                      <option value="">{t("ยังไม่กำหนด")}</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold sm:col-span-2">{t("รายละเอียด")}<textarea
                      className={control}
                      value={zone.description}
                      onChange={(e) =>
                        setZone({ ...zone, description: e.target.value })
                      }
                    />
                  </label>
                  {outside.length > 0 && (
                    <div className="rounded-lg bg-amber-50 p-3 text-sm sm:col-span-2">
                      <p>{t("ไมค์ที่สังกัดอยู่นอกขอบเขตใหม่:")}</p>
                      <ul>
                        {outside.map((s) => (
                          <li key={s.id}>
                            {s.station_code} · {s.name}
                          </li>
                        ))}
                      </ul>
                      <label className="flex min-h-11 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={acceptOutside}
                          onChange={(e) => setAcceptOutside(e.target.checked)}
                        />{t("ยืนยันขอบเขตนี้และคงสังกัดไมค์เดิม")}</label>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                    <button
                      type="button"
                      className={secondary}
                      onClick={cancel}
                    >{t("ยกเลิก")}</button>
                    <button
                      className={primary}
                      disabled={
                        !finished ||
                        !!geometryError ||
                        (outside.length > 0 && !acceptOutside)
                      }
                    >{t("บันทึกขอบเขต")}</button>
                  </div>
                </fieldset>
              </form>
            ) : mode === "station" ? (
              <form onSubmit={saveStation} className={panel}>
                <h2 className="text-lg font-bold">
                  {editingStation ? t("แก้ไขไมค์") : t("เพิ่มไมค์")}
                </h2>
                <fieldset
                  disabled={busy}
                  className="grid min-w-0 gap-3 sm:grid-cols-2"
                >
                  {(
                    [
                      { key: "code", label: "รหัสไมค์" },
                      { key: "name", label: "ชื่อจุดติดตั้ง" },
                    ] as const
                  ).map((f) => (
                    <label key={f.key} className="block text-sm font-semibold">
                      {t(f.label)}
                      <input
                        className={control}
                        value={station[f.key]}
                        required
                        onChange={(e) =>
                          setStation({ ...station, [f.key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <label className="block text-sm font-semibold">{t("สังกัดโซนป่าไม้")}<select
                      className={control}
                      value={station.zone}
                      onChange={(e) =>
                        setStation({ ...station, zone: e.target.value })
                      }
                    >
                      <option value="">{t("ไม่สังกัดโซน")}</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
                    {(
                      [
                        { key: "lat", label: "ละติจูด" },
                        { key: "lng", label: "ลองจิจูด" },
                        { key: "radius", label: "รัศมี (เมตร)" },
                      ] as const
                    ).map((f) => (
                      <label
                        key={f.key}
                        className="block text-sm font-semibold"
                      >
                        {t(f.label)}
                        <input
                          className={control}
                          type="number"
                          step="any"
                          required
                          value={station[f.key]}
                          onChange={(e) =>
                            setStation({ ...station, [f.key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm font-semibold">{t("สถานะ")}<select
                      className={control}
                      value={station.status}
                      onChange={(e) =>
                        setStation({
                          ...station,
                          status: e.target.value as StationStatus,
                        })
                      }
                    >
                      <option value="online">{t("ออนไลน์")}</option>
                      <option value="offline">{t("ออฟไลน์")}</option>
                      <option value="maintenance">{t("ซ่อมบำรุง")}</option>
                    </select>
                  </label>
                  <label className="block text-sm font-semibold sm:col-span-2">{t("หมายเหตุ")}<textarea
                      className={control}
                      value={station.notes}
                      onChange={(e) =>
                        setStation({ ...station, notes: e.target.value })
                      }
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
                    <button
                      type="button"
                      className={secondary}
                      onClick={cancel}
                    >{t("ยกเลิก")}</button>
                    <button className={primary}>{t("บันทึกไมค์")}</button>
                  </div>
                </fieldset>
              </form>
            ) : null}
          </section>
        )}
      </div>
      {mode === "view" && (
        <section aria-label={t("รายการโซนและเสาไมค์")} className="space-y-2">
          <div
            role="tablist"
            aria-label={t("ประเภทรายการ")}
            className="flex flex-wrap gap-2"
          >
            {directoryTabs.map((item) => {
              const selected = tab === item;
              return (
                <button
                  key={item}
                  ref={tabRefs[item]}
                  id={`directory-tab-${item}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`directory-panel-${item}`}
                  tabIndex={selected ? 0 : -1}
                  className={selected ? primary : secondary}
                  onClick={() => setTab(item)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "Home"
                        ? "zones"
                        : event.key === "End"
                          ? "stations"
                          : event.key === "ArrowLeft" ||
                              event.key === "ArrowRight"
                            ? item === "zones"
                              ? "stations"
                              : "zones"
                            : undefined;
                    if (!next) return;
                    event.preventDefault();
                    setTab(next);
                    tabRefs[next].current?.focus();
                  }}
                >
                  {item === "zones"
                    ? (t("โซนป่า (") + zones.length + ")")
                    : (t("เสาไมค์ (") + stations.length + ")")}
                </button>
              );
            })}
          </div>
          {directoryTabs.map((item) => (
            <div
              key={item}
              id={`directory-panel-${item}`}
              role="tabpanel"
              aria-labelledby={`directory-tab-${item}`}
              hidden={item !== tab}
              className="space-y-2"
            >
              {item === tab && (
                <>
                  <input
                    type="search"
                    className={control + " sm:max-w-sm"}
                    aria-label={item === "zones" ? t("ค้นหาโซนป่า") : t("ค้นหาเสาไมค์")}
                    placeholder={
                      item === "zones" ? t("ค้นหาชื่อหรือรหัสโซน") : t("ค้นหาชื่อหรือรหัสไมค์")
                    }
                    value={queries[item]}
                    onChange={(e) =>
                      setQueries({ ...queries, [item]: e.target.value })
                    }
                  />
                  {!loading &&
                    !loadError &&
                    !visibleZones.length &&
                    !visibleStations.length && (
                      <p className="rounded-lg border border-[#D4DCD5] bg-white p-3 text-sm text-[#526358]">
                        {query
                          ? t("ไม่พบรายการที่ตรงกับการค้นหา")
                          : item === "zones"
                            ? t("ยังไม่มีโซนป่า")
                            : t("ยังไม่มีเสาไมค์")}
                      </p>
                    )}
                  <div className="grid gap-2 xl:grid-cols-2">
                    {visibleZones.map((z) => (
                      <article key={z.id} className={compactCard}>
                        <div className="min-w-0 flex-1 basis-52">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="break-words font-semibold">
                              {z.name}
                            </h3>
                            <RiskBadge size="xs" level={z.current_risk_level} />
                          </div>
                          <p className="mt-1 text-xs text-[#526358]">
                            {z.zone_code} · {z.area_rai?.toLocaleString()}{t(" ไร่ ·")}{" "}
                            {stations.filter((s) => s.zone_id === z.id).length}{" "}{t("ไมค์")}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={secondary}
                            onClick={() => startZone(z)}
                          >{t("แก้ไขขอบเขต")}</button>
                          <Link className={secondary} href={"/zones/" + z.id}>{t("รายละเอียดโซน")}</Link>
                          {admin && (
                            <button
                              type="button"
                              className={secondary + " text-red-800"}
                              onClick={() => setDeletingZone(z)}
                            >{t("ลบโซน")}</button>
                          )}
                        </div>
                      </article>
                    ))}
                    {visibleStations.map((s) => (
                      <article key={s.id} className={compactCard}>
                        <div className="min-w-0 flex-1 basis-48">
                          <h3 className="break-words font-semibold">
                            {s.station_code} · {s.name}
                          </h3>
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-[#526358]">
                            <MapPin
                              size={14}
                              className="shrink-0"
                              aria-hidden="true"
                            />
                            {zones.find((z) => z.id === s.zone_id)?.name ||
                              t("ไม่สังกัดโซน")}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={secondary}
                            onClick={() => startStation(s)}
                          >{t("แก้ไขไมค์")}</button>
                          {admin && (
                            <button
                              className={secondary + " text-red-800"}
                              onClick={() => setDeleting(s)}
                            >{t("ลบไมค์")}</button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </section>
      )}
      {deletingZone && (
        <DeleteDialog
          kind="zone"
          id={deletingZone.id}
          name={
            deletingZone.zone_code
              ? `${deletingZone.zone_code} · ${deletingZone.name}`
              : deletingZone.name
          }
          onClose={() => setDeletingZone(undefined)}
          onDeleted={() => {
            setZones((list) =>
              list.filter((zone) => zone.id !== deletingZone.id),
            );
            if (editingZone === deletingZone.id) setEditingZone(undefined);
            setDeletingZone(undefined);
            setFeedback("ลบโซนป่าออกจากรายการใช้งานแล้ว");
            requestAnimationFrame(() => zoneTab.current?.focus());
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          kind="station"
          id={deleting.id}
          name={`${deleting.station_code} · ${deleting.name}`}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => {
            setStations((list) => list.filter((s) => s.id !== deleting.id));
            if (editingStation === deleting.id) cancel();
            setDeleting(undefined);
            setFeedback("ลบไมค์จากรายการใช้งานแล้ว ประวัติเดิมยังคงอยู่");
          }}
        />
      )}
    </div>
  );
}
