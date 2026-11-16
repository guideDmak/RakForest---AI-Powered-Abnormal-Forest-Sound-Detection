/**
 * Geodesic and Polygon helper utilities for RakForest GIS
 */

const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Generates a geodesic circle polygon ([lng, lat][]) for a given center and radius in meters.
 * Used to render sensor_stations listening radius on MapLibre GL JS.
 */
export function createCirclePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  steps = 72,
): [number, number][] {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;
  const delta = radiusMeters / EARTH_RADIUS_METERS;

  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * Math.PI * 2;
    const sinPhi =
      Math.sin(phi) * Math.cos(delta) +
      Math.cos(phi) * Math.sin(delta) * Math.cos(bearing);
    const latRad = Math.asin(Math.max(-1, Math.min(1, sinPhi)));
    const lngRad =
      lambda +
      Math.atan2(
        Math.sin(bearing) * Math.sin(delta) * Math.cos(phi),
        Math.cos(delta) - Math.sin(phi) * Math.sin(latRad),
      );
    coords.push([(lngRad * 180) / Math.PI, (latRad * 180) / Math.PI]);
  }
  return coords;
}

/**
 * Calculates approximate polygon area in Thai Rai (1 Rai = 1,600 sq.m.)
 * from an array of [lng, lat] coordinates using spherical excess / shoelace projection.
 */
export function calculatePolygonAreaRai(coords: [number, number][]): number {
  if (!coords || coords.length < 3) return 0;
  const ring =
    coords[0][0] === coords[coords.length - 1][0] &&
    coords[0][1] === coords[coords.length - 1][1]
      ? coords
      : [...coords, coords[0]];

  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i],
      [lng2, lat2] = ring[i + 1];
    sum +=
      (((lng2 - lng1) * Math.PI) / 180) *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return (
    Math.round(((Math.abs(sum) * EARTH_RADIUS_METERS ** 2) / 2 / 1600) * 100) /
    100
  );
}

/**
 * Checks whether a point [lng, lat] lies inside a polygon [lng, lat][]
 */
export function isPointInPolygon(
  point: [number, number],
  polygon: [number, number][],
): boolean {
  if (!polygon || polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates distance in meters between two coordinates using Haversine formula
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type PolygonPoint = [number, number];
export function openPolygon(points: PolygonPoint[]): PolygonPoint[] {
  const ring = points.map((p) => [...p] as PolygonPoint);
  if (
    ring.length > 1 &&
    ring[0][0] === ring.at(-1)![0] &&
    ring[0][1] === ring.at(-1)![1]
  )
    ring.pop();
  return ring;
}
function orientation(a: PolygonPoint, b: PolygonPoint, c: PolygonPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: PolygonPoint, b: PolygonPoint, p: PolygonPoint) {
  return (
    Math.abs(orientation(a, b, p)) < 1e-12 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-12 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12
  );
}
function intersects(
  a: PolygonPoint,
  b: PolygonPoint,
  c: PolygonPoint,
  d: PolygonPoint,
) {
  const o1 = orientation(a, b, c),
    o2 = orientation(a, b, d),
    o3 = orientation(c, d, a),
    o4 = orientation(c, d, b);
  return (
    (o1 * o2 < 0 && o3 * o4 < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
export function validatePolygon(points: PolygonPoint[]): PolygonPoint[] {
  if (
    !Array.isArray(points) ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    )
  )
    throw new Error("พิกัดขอบเขตไม่ถูกต้อง");
  const ring = openPolygon(points);
  if (ring.length < 3) throw new Error("กำหนดขอบเขตอย่างน้อย 3 จุด");
  if (ring.length > 1000) throw new Error("ขอบเขตรองรับไม่เกิน 1,000 จุด");
  if (new Set(ring.map((p) => p.join(","))).size !== ring.length)
    throw new Error("มีจุดซ้ำ กรุณาลบจุดที่ซ้ำกัน");
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length,
      previous = (i + ring.length - 1) % ring.length;
    if (
      onSegment(ring[previous], ring[i], ring[next]) ||
      onSegment(ring[i], ring[next], ring[previous])
    )
      throw new Error("ขอบเขตมีเส้นซ้อนกันหรือย้อนทับกัน");
    for (let j = i + 1; j < ring.length; j++) {
      const end = (j + 1) % ring.length;
      if (j === next || end === i) continue;
      if (intersects(ring[i], ring[next], ring[j], ring[end]))
        throw new Error("เส้นขอบเขตตัดกัน กรุณาลากแก้หรือลบจุดก่อนบันทึก");
    }
  }
  if (calculatePolygonAreaRai(ring) <= 0)
    throw new Error("พื้นที่ต้องมากกว่าศูนย์ กรุณาขยายขอบเขต");
  return ring;
}
export function pointWithinBoundary(
  point: PolygonPoint,
  polygon: PolygonPoint[],
) {
  const ring = openPolygon(polygon);
  return (
    isPointInPolygon(point, ring) ||
    ring.some((p, i) => onSegment(p, ring[(i + 1) % ring.length], point))
  );
}
