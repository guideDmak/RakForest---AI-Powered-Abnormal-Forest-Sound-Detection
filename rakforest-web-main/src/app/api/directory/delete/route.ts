import {
  DeleteError,
  deleteDirectory,
  parseDeleteInput,
} from "@/lib/accounts/delete-server";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; until: number }>();

function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const protocol = new URL(request.url).protocol;
    return new URL(origin).origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    if (!hasSameOrigin(request))
      return Response.json({ message: "คำขอไม่ถูกต้อง" }, { status: 403 });
    const text = await request.text();
    if (text.length > 4096)
      return Response.json({ message: "ข้อมูลยาวเกินไป" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return Response.json({ message: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
    }
    const input = parseDeleteInput(body);
    const now = Date.now();
    for (const [id, entry] of attempts)
      if (entry.until <= now) attempts.delete(id);
    const entry = attempts.get(input.actorId) ?? {
      count: 0,
      until: now + 300000,
    };
    if (entry.count >= 5)
      return Response.json(
        { message: "ยืนยันไม่สำเร็จหลายครั้ง กรุณารอ 5 นาที" },
        { status: 429 },
      );
    entry.count++;
    attempts.set(input.actorId, entry);
    const result = await deleteDirectory(input);
    attempts.delete(input.actorId);
    return Response.json(result, {
      status: result.blocked ? 409 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        message:
          error instanceof DeleteError
            ? error.message
            : "ติดต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่",
      },
      { status: error instanceof DeleteError ? error.status : 503 },
    );
  }
}
