import { assertEquals } from "./assert.ts";
import { handleReviewRequest } from "../src/review/handler.ts";

const pending = { id: "candidate", name: "Candidate", governanceState: "pending_public" };
function context(
  actor: { id: string; kind: "human"; role: "auditor" | "reader" } = {
    id: "human:auditor",
    kind: "human",
    role: "auditor",
  },
) {
  const calls: string[] = [];
  const catalog = {
    list: () => Promise.resolve([pending]),
    approve: () => {
      calls.push("approve");
      return Promise.resolve({ ...pending, governanceState: "approved_public" });
    },
    reject: () => {
      calls.push("reject");
      return Promise.resolve({ ...pending, governanceState: "rejected" });
    },
  };
  const access = { resolveSession: () => Promise.resolve(actor) };
  return { context: { catalog, access } as never, calls };
}
const request = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1${path}`, init);

Deno.test("review rejects unauthenticated GET and non-auditor POST", async () => {
  const get = await handleReviewRequest(
    request("/review"),
    {
      catalog: {} as never,
      access: { resolveSession: () => Promise.reject(new Error("not used")) },
    } as never,
  );
  assertEquals(get.status, 401);
  const reader = context({ id: "human:reader", kind: "human", role: "reader" });
  const response = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers: { "x-portico-session": "s", "content-type": "application/json" },
      body: JSON.stringify({ id: "candidate" }),
    }),
    reader.context,
  );
  assertEquals(response.status, 403);
});

Deno.test("review POST routes approve and reject and GET is HTML", async () => {
  const state = context();
  const headers = { "x-portico-session": "s", "content-type": "application/json" };
  const approve = await handleReviewRequest(
    request("/review/approve", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "candidate" }),
    }),
    state.context,
  );
  assertEquals(approve.status, 200);
  assertEquals(state.calls, ["approve"]);
  const reject = await handleReviewRequest(
    request("/review/reject", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "candidate" }),
    }),
    state.context,
  );
  assertEquals(reject.status, 200);
  assertEquals(state.calls, ["approve", "reject"]);
  const page = await handleReviewRequest(
    request("/review", { headers: { "x-portico-session": "s" } }),
    state.context,
  );
  assertEquals(page.status, 200);
  assertEquals((await page.text()).includes("Human review"), true);
});
