import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { probeInstance } from "./start-local.mjs";
test("launcher reuses matching server, does not stop foreign server, and detects free port", async () => {
  assert.equal(
    await probeInstance(
      3000,
      "same",
      async () =>
        new Response(
          JSON.stringify({ app: "rakforest-web", fingerprint: "same" }),
        ),
    ),
    "same",
  );
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(
      await probeInstance(
        port,
        "same",
        async () =>
          new Response(
            JSON.stringify({ app: "different", fingerprint: "different" }),
          ),
      ),
      "occupied",
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(
    await probeInstance(port, "same", async () => {
      throw new Error("offline");
    }),
    "free",
  );
});
