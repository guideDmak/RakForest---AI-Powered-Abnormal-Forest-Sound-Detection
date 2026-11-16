import { createClient } from "@/lib/supabase/client";
import { accountError } from "@/lib/accounts/validation";
import { validatePolygon, calculatePolygonAreaRai } from "@/lib/utils/geo";
import type { ForestZone, SensorStation } from "@/types/database.types";
export async function readZones(): Promise<ForestZone[]> {
  const { data, error } = await createClient()
    .from("forest_zones")
    .select("*")
    .is("deleted_at", null)
    .order("name")
    .retry(false);
  if (error) throw accountError(error);
  return data as ForestZone[];
}
export async function readStations(): Promise<SensorStation[]> {
  const { data, error } = await createClient()
    .from("sensor_stations")
    .select("*")
    .is("deleted_at", null)
    .order("station_code")
    .retry(false);
  if (error) throw accountError(error);
  return data as SensorStation[];
}
export async function writeZone(
  zone: Partial<ForestZone> & {
    name: string;
    polygon_coords: [number, number][];
  },
): Promise<ForestZone> {
  const points = validatePolygon(zone.polygon_coords);
  const code = zone.zone_code?.trim().toUpperCase();
  if (!code || !zone.name.trim()) throw new Error("กรุณาระบุรหัสและชื่อโซน");
  const payload = {
    zone_code: code,
    name: zone.name.trim(),
    province: zone.province?.trim() || null,
    district: zone.district?.trim() || null,
    area_rai: calculatePolygonAreaRai(points),
    polygon_coords: points,
    current_risk_level: zone.current_risk_level ?? "green",
    responsible_officer_id: zone.responsible_officer_id ?? null,
    description: zone.description?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const table = createClient().from("forest_zones");
  const query = zone.id
    ? table.update(payload).eq("id", zone.id).is("deleted_at", null)
    : table.insert(payload);
  const { data, error } = await query.select("*").single();
  if (error)
    throw error.code === "23505"
      ? new Error("รหัสโซนซ้ำ กรุณาใช้รหัสอื่น")
      : accountError(error);
  return data as ForestZone;
}
export async function writeStation(
  station: Partial<SensorStation> & {
    station_code: string;
    name: string;
    lat: number;
    lng: number;
  },
): Promise<SensorStation> {
  if (!station.station_code.trim() || !station.name.trim())
    throw new Error("กรุณาระบุรหัสและชื่อไมค์");
  if (
    !Number.isFinite(station.lat) ||
    !Number.isFinite(station.lng) ||
    Math.abs(station.lat) > 90 ||
    Math.abs(station.lng) > 180
  )
    throw new Error("พิกัดไมค์ไม่ถูกต้อง");
  const radius = station.radius_meters ?? 350;
  if (!Number.isFinite(radius) || radius <= 0 || radius > 100000)
    throw new Error("รัศมีต้องมากกว่า 0 และไม่เกิน 100,000 เมตร");
  const payload = {
    station_code: station.station_code.trim().toUpperCase(),
    name: station.name.trim(),
    lat: station.lat,
    lng: station.lng,
    radius_meters: radius,
    status: station.status ?? "online",
    notes: station.notes?.trim() || null,
    updated_at: new Date().toISOString(),
    ...(station.zone_id !== undefined
      ? { zone_id: station.zone_id }
      : !station.id
        ? { zone_id: null }
        : {}),
  };
  const table = createClient().from("sensor_stations");
  const query = station.id
    ? table.update(payload).eq("id", station.id).is("deleted_at", null)
    : table.insert(payload);
  const { data, error } = await query.select("*").single();
  if (error)
    throw error.code === "23505"
      ? new Error("รหัสไมค์ซ้ำ กรุณาใช้รหัสอื่น")
      : accountError(error);
  return data as SensorStation;
}
