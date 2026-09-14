import { assert, assertEquals } from "./assert.ts";
import { FileSessionStore } from "../src/access/mod.ts";
import { FileCatalogStore, MemoryCatalogStore } from "../src/catalog/mod.ts";
import { FileGatewayAuditStore, type GatewayAuditRecord } from "../src/gateway/mod.ts";
import { FilePageStore } from "../src/ui/mod.ts";

/**
 * Every store is a whole-file read → mutate → write, and `await` interleaves.
 * Two concurrent calls both load, both mutate their own copy, and the second
 * write silently discards the first. The Gateway appends to its access audit on
 * every request, so concurrent requests used to lose audit records — an audit
 * gap rather than a data glitch.
 */

const CONCURRENT = 40;

function auditRecord(index: number): GatewayAuditRecord {
  return {
    id: `gwa-concurrent-${index}`,
    surfaceId: `surface-${index}`,
    decision: "denied",
    reason: "NOT_FOUND",
    actor: { id: "anonymous", kind: "human", role: "anonymous" },
    at: new Date().toISOString(),
  };
}

Deno.test("concurrent gateway audit appends are all recorded", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-serialize-" });
  const store = new FileGatewayAuditStore(`${dir}/audit.json`);

  // Deliberately not awaited one at a time: this is the interleaving that lost
  // records. Every call must land.
  await Promise.all(
    Array.from({ length: CONCURRENT }, (_, index) => store.append(auditRecord(index))),
  );

  const records = await store.list();
  assertEquals(records.length, CONCURRENT);
  assertEquals(new Set(records.map((record) => record.id)).size, CONCURRENT);
});

Deno.test("concurrent session writes do not lose each other", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-serialize-session-" });
  const store = new FileSessionStore(`${dir}/sessions.json`);

  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.commitSession({
        id: `ses-${index}`,
        subjectId: `human:user-${index}`,
        tokenHash: `hash-${index}`,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      })),
  );

  assertEquals((await store.listSessions()).length, 12);
});

Deno.test("a rejected write does not stall the queue behind it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-serialize-reject-" });
  const store = new FileSessionStore(`${dir}/sessions.json`);
  const session = (index: number) => ({
    id: `ses-${index}`,
    subjectId: `human:user-${index}`,
    tokenHash: `hash-${index}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  const results = await Promise.allSettled([
    store.commitSession(session(0)),
    // A duplicate id rejects; the append queued behind it must still run.
    store.commitSession(session(0)),
    store.commitSession(session(1)),
  ]);

  assert(results.some((item) => item.status === "rejected"));
  assertEquals(
    (await store.listSessions()).map((item) => item.id).sort(),
    ["ses-0", "ses-1"],
  );
});

Deno.test("the memory and file stores still agree on an empty read", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-serialize-empty-" });
  assertEquals(await new MemoryCatalogStore().list(), []);
  assertEquals(await new FileCatalogStore(`${dir}/catalog.json`).list(), []);
  assertEquals(await new FilePageStore(`${dir}/page.json`).load(), undefined);
});
