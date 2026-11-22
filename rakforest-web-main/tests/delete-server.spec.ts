import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { POST } from "../src/app/api/directory/delete/route";
import { admin, pending } from "./accounts-fixture";

test("server requires origin, administrator and own password before calling service-only delete RPC", async () => {
  let rpcCalls = 0;
  let role = "super_admin";
  let deleted = false;
  let blocked = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/rest/v1/profiles")) {
      res.end(
        JSON.stringify({
          ...admin,
          role,
          password_hash: "Admin123!",
          deleted_at: deleted ? "2026-11-15" : null,
        }),
      );
      return;
    }
    if (req.url?.startsWith("/rest/v1/rpc/soft_delete_directory")) {
      rpcCalls++;
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      expect(payload).not.toHaveProperty("password");
      expect(payload.p_password_version).toMatch(/^[a-f0-9]{32}$/);
      expect(req.headers.apikey).toBe("server-test-key");
      res.end(
        JSON.stringify(
          blocked
            ? {
                blocked: true,
                items: [{ id: "task", kind: "report", name: "RF-TEST" }],
              }
            : { deleted: true },
        ),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  const saved = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-test-key";
  const request = (password: string, origin = "http://localhost:3000") =>
    new Request("http://localhost:3000/api/directory/delete", {
      method: "POST",
      headers: { origin, host: "localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "profile",
        actorId: admin.id,
        targetId: pending.id,
        password,
      }),
    });
  try {
    expect((await POST(request("Admin123!", "http://evil.test"))).status).toBe(
      403,
    );
    expect(rpcCalls).toBe(0);
    expect((await POST(request("bad"))).status).toBe(401);
    expect(rpcCalls).toBe(0);
    role = "field_ranger";
    expect((await POST(request("Admin123!"))).status).toBe(403);
    expect(rpcCalls).toBe(0);
    role = "super_admin";
    deleted = true;
    expect((await POST(request("Admin123!"))).status).toBe(403);
    expect(rpcCalls).toBe(0);
    deleted = false;
    expect((await POST(request("Admin123!"))).status).toBe(200);
    expect(rpcCalls).toBe(1);
    blocked = true;
    const response = await POST(request("Admin123!"));
    expect(response.status).toBe(409);
    expect((await response.json()).items).toHaveLength(1);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await POST(request("Admin123!"))).status).toBe(503);
  } finally {
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
