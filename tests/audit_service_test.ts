import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import { AccessService, MemoryIdentityStore, MemorySessionStore } from "../src/access/mod.ts";
import { AuditService } from "../src/audit/mod.ts";
import {
  type Actor,
  type AgentSurface,
  type ApprovalRecord,
  type CatalogChangeRecord,
  CatalogService,
  type CatalogStore,
  FileCatalogStore,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";
import { GatewayService, MemoryGatewayAuditStore } from "../src/gateway/mod.ts";

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const reader: Actor = {
  id: "human:reader",
  kind: "human",
  role: "reader",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

function surface(): RegisterInput {
  return {
    id: "docs-writer",
    name: "Docs Writer",
    description: "Drafts internal documentation.",
    channels: ["cli"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "package", value: "jsr:@example/docs-writer" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function mcpSurface(): RegisterInput {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: "https://mcp.example.test/servers/docs" },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

async function seeded(): Promise<{
  access: AccessService;
  catalog: CatalogService;
  audit: AuditService;
}> {
  const access = new AccessService(new MemoryIdentityStore());
  await access.grant(null, {
    id: auditor.id,
    kind: "human",
    role: "auditor",
  });
  await access.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await access.grant(auditor, {
    id: reader.id,
    kind: "human",
    role: "reader",
  });
  const catalog = new CatalogService(new MemoryCatalogStore());
  return { access, catalog, audit: new AuditService(catalog, access) };
}

Deno.test("auditor timeline includes grants, catalog changes, and public approval", async () => {
  const { catalog, audit } = await seeded();
  await catalog.register(maintainer, surface());
  await catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await catalog.approve(auditor, { id: "docs-writer" });

  const events = await audit.list(auditor);
  const kinds = events.map((item) => item.kind);
  assert(kinds.includes("grant"), "expected grant events");
  assert(kinds.includes("catalog"), "expected catalog events");
  assert(kinds.includes("approval"), "expected approval events");

  const grant = events.find((item) => item.kind === "grant" && item.subjectId === "agent:docs-bot");
  assertEquals(grant?.action, "grant");
  assertEquals(grant?.summary.includes("maintainer"), true);

  const registered = events.find((item) => item.action === "register");
  assertEquals(registered?.subjectId, "docs-writer");
  assertEquals(registered?.actor.id, "agent:docs-bot");

  const approved = events.find((item) => item.kind === "approval");
  assertEquals(approved?.action, "approved");
  assertEquals(approved?.subjectId, "docs-writer");
  assertEquals(approved?.actor.id, "human:security-auditor");
});

Deno.test("maintainer agent and anonymous cannot read the security audit view", async () => {
  const { catalog, audit } = await seeded();
  await catalog.register(maintainer, surface());

  await assertRejectsCode(() => audit.list(maintainer), "FORBIDDEN");
  await assertRejectsCode(() => audit.list(reader), "FORBIDDEN");
  await assertRejectsCode(() => audit.list(anonymous), "FORBIDDEN");

  const events = await audit.list(auditor);
  assert(events.some((item) => item.kind === "catalog"));
});

Deno.test("gateway access appears on the auditor timeline when a store is attached", async () => {
  const access = new AccessService(new MemoryIdentityStore());
  await access.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await access.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await access.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  const catalog = new CatalogService(new MemoryCatalogStore());
  const gateway = new GatewayService(catalog, new MemoryGatewayAuditStore());
  const audit = new AuditService(catalog, access, gateway);

  await catalog.register(maintainer, mcpSurface());
  await gateway.authorize(reader, "docs-mcp");

  const events = await audit.list(auditor);
  const allowed = events.find((item) => item.kind === "gateway");
  assertEquals(allowed?.action, "allowed");
  assertEquals(allowed?.subjectId, "docs-mcp");
});

Deno.test("failed register does not dirty catalog file or appear as a catalog audit event", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-audit-" });
  const catalogPath = `${dir}/catalog.json`;
  const identities = new MemoryIdentityStore();
  const access = new AccessService(identities);
  await access.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await access.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  const catalog = new CatalogService(new FileCatalogStore(catalogPath));
  const audit = new AuditService(catalog, access);

  await assertRejectsCode(
    () => catalog.register(reader, surface()),
    "FORBIDDEN",
  );

  let present = true;
  try {
    await Deno.stat(catalogPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed register must not create the catalog file");

  const events = await audit.list(auditor);
  assertEquals(events.filter((item) => item.kind === "catalog"), []);
});

Deno.test("reading audit does not rewrite grant or approval conclusions", async () => {
  const { catalog, access, audit } = await seeded();
  await catalog.register(maintainer, surface());
  await catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await catalog.approve(auditor, { id: "docs-writer" });

  const before = await audit.list(auditor);
  const again = await audit.list(auditor);
  assertEquals(again, before);

  await assertRejectsCode(
    () => catalog.approve(maintainer, { id: "docs-writer" }),
    "FORBIDDEN",
  );
  const grants = await access.listGrants(auditor);
  const after = await audit.list(auditor);
  assertEquals(after, before);
  assertEquals(grants.length > 0, true);
});

Deno.test("auditor timeline includes identity revoke; failed revoke does not appear", async () => {
  const { access, catalog, audit } = await seeded();
  await catalog.register(maintainer, surface());

  const revoked = await access.revoke(auditor, { id: maintainer.id });
  assertEquals(revoked.revoked, true);

  const events = await audit.list(auditor);
  const revokeEvent = events.find((item) => item.kind === "revoke");
  assertEquals(revokeEvent?.action, "revoke");
  assertEquals(revokeEvent?.subjectId, maintainer.id);
  assertEquals(revokeEvent?.actor.id, auditor.id);

  await assertRejectsCode(() => access.revoke(reader, { id: reader.id }), "FORBIDDEN");
  const again = await audit.list(auditor);
  assertEquals(again.filter((item) => item.kind === "revoke").length, 1);
});

Deno.test("auditor timeline includes credential revoke; identity stays and failed revoke is absent", async () => {
  const sessions = new MemorySessionStore();
  const access = new AccessService(new MemoryIdentityStore(), sessions);
  await access.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await access.grant(auditor, {
    id: maintainer.id,
    kind: "agent",
    role: "maintainer",
  });
  await access.grant(auditor, { id: reader.id, kind: "human", role: "reader" });
  const catalog = new CatalogService(new MemoryCatalogStore());
  const audit = new AuditService(catalog, access);

  const issued = await access.issueCredential(auditor, { id: reader.id });
  await access.login({ id: reader.id, token: issued.token });
  await access.revokeCredentials(auditor, { id: reader.id });

  const events = await audit.list(auditor);
  const credential = events.find((item) => item.kind === "credential");
  assertEquals(credential?.action, "revoke_credential");
  assertEquals(credential?.subjectId, reader.id);
  assertEquals(credential?.actor.id, auditor.id);
  assertEquals(events.some((item) => item.kind === "revoke"), false);

  await assertRejectsCode(
    () => access.revokeCredentials(maintainer, { id: reader.id }),
    "FORBIDDEN",
  );
  const again = await audit.list(auditor);
  assertEquals(again.filter((item) => item.kind === "credential").length, 1);
});

/** A store whose approvals were edited on disk until their refs no longer read. */
class DamagedApprovalStore implements CatalogStore {
  constructor(private readonly inner: CatalogStore) {}

  list(): Promise<AgentSurface[]> {
    return this.inner.list();
  }

  get(id: string): Promise<AgentSurface | undefined> {
    return this.inner.get(id);
  }

  put(record: AgentSurface): Promise<void> {
    return this.inner.put(record);
  }

  listSeal() {
    return this.inner.listSeal();
  }

  listChanges(): Promise<CatalogChangeRecord[]> {
    return this.inner.listChanges();
  }

  commitChange(record: AgentSurface, change: CatalogChangeRecord): Promise<void> {
    return this.inner.commitChange(record, change);
  }

  commitApproval(record: AgentSurface, approval: ApprovalRecord): Promise<void> {
    return this.inner.commitApproval(record, approval);
  }

  commitRemoval(id: string, change: CatalogChangeRecord): Promise<void> {
    return this.inner.commitRemoval(id, change);
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    const records = await this.inner.listApprovals();
    // An approval that lost its reviewer, its subject and its timestamp: the
    // shape a file edit leaves behind, not a shape any writer produces.
    return records.map(() => ({ id: "apr-damaged", decision: "approved" }) as ApprovalRecord);
  }
}

Deno.test("a record damaged on disk still appears, credited to nobody, instead of failing the read", async () => {
  const access = new AccessService(new MemoryIdentityStore());
  await access.grant(null, { id: auditor.id, kind: "human", role: "auditor" });
  await access.grant(auditor, { id: maintainer.id, kind: "agent", role: "maintainer" });
  const inner = new MemoryCatalogStore();
  const catalog = new CatalogService(inner);
  await catalog.register(maintainer, surface());
  await catalog.publish(maintainer, { id: "docs-writer", visibility: "public" });
  await catalog.approve(auditor, { id: "docs-writer" });

  const damaged = new CatalogService(new DamagedApprovalStore(inner));
  const audit = new AuditService(damaged, access);

  // The whole timeline is one read: a single unreadable record must not decide
  // whether the audit page renders at all, and it must not be silently dropped
  // either — an auditor has to be able to see that something is there and wrong.
  const events = await audit.list(auditor);
  const approval = events.find((item) => item.kind === "approval");
  assertEquals(approval?.id, "apr-damaged");
  assertEquals(approval?.action, "approved");
  assertEquals(approval?.actor.id, "anonymous", "an unreadable ref credits nobody");
  assertEquals(approval?.actor.role, "anonymous");
  assertEquals(approval?.subjectId, "unknown", "a missing field is reported as missing");
  assertEquals(approval?.at, "unknown");

  // The damaged record names no entry, so the timeline carries none rather than
  // inventing a coordinate from whatever was left in the file.
  assertEquals(approval?.entry, undefined);
});
