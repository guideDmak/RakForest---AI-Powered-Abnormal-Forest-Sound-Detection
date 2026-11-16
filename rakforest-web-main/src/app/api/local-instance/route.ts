import { createHash } from "node:crypto";
import { resolve } from "node:path";
export const dynamic = "force-dynamic";
export function GET() {
  if (process.env.NODE_ENV !== "development")
    return new Response(null, { status: 404 });
  const directory = resolve(process.cwd());
  return Response.json(
    {
      app: "rakforest-web",
      fingerprint: createHash("sha256")
        .update(
          process.platform === "win32" ? directory.toLowerCase() : directory,
        )
        .digest("hex"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
