import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  FileCatalogStore,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

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

const auditor: Actor = {
  id: "human:security-auditor",
  kind: "human",
  role: "auditor",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

const MCP_ENDPOINT = "https://mcp.example.test/servers/docs";

function internalMcp(): RegisterInput {
  return {
    id: "docs-mcp",
    name: "Docs MCP",
    description: "External documentation MCP server.",
    channels: ["mcp"],
    version: "1.0.0",
    visibility: "internal",
    entry: { kind: "mcp_endpoint", value: MCP_ENDPOINT },
    maintainers: [{ id: "agent:docs-bot", kind: "agent" }],
  };
}

function internalCli(): RegisterInput {
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("maintainer registers an MCP surface; reader lists and describes the same endpoint", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, internalMcp());

  assertEquals(created.id, "docs-mcp");
  assertEquals(created.channels, ["mcp"]);
  assertEquals(created.entry, { kind: "mcp_endpoint", value: MCP_ENDPOINT });
  assertEquals(created.governanceState, "internal");

  const listed = await service.listMcp(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-mcp");
  assertEquals(listed[0].name, "Docs MCP");
  assertEquals(listed[0].endpoint, { kind: "mcp_endpoint", value: MCP_ENDPOINT });
  assertEquals(listed[0].connect, { mode: "direct" });
  assertEquals(listed[0].governanceState, "internal");

  const described = await service.describeMcp(reader, "docs-mcp");
  assertEquals(described.id, "docs-mcp");
  assertEquals(described.endpoint.value, MCP_ENDPOINT);
  assertEquals(described.connect.mode, "direct");
});

Deno.test("CLI-only surfaces do not appear in MCP list or describe", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  assertEquals(await service.listMcp(reader), []);
  await assertRejectsCode(() => service.describeMcp(reader, "docs-writer"), "NOT_FOUND");
});

Deno.test("reader cannot register an MCP surface; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(() => service.register(reader, internalMcp()), "FORBIDDEN");
  assertEquals(await store.list(), []);
  assertEquals(await service.listMcp(maintainer), []);
});

Deno.test("mcp channel with a non-endpoint entry is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.entry = { kind: "package", value: "jsr:@example/docs-mcp" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("mcp_endpoint without the mcp channel is rejected and does not write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.entry = { kind: "mcp_endpoint", value: MCP_ENDPOINT };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("mixed cli+mcp channels are rejected; one surface has one entry", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.channels = ["cli", "mcp"];

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret in an MCP endpoint query is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.entry = {
    kind: "mcp_endpoint",
    value: "https://mcp.example.test/servers/docs?token=sk-live-not-a-real-secret",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("common secret query param spellings in an MCP endpoint are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const aliases = [
    "apikey",
    "access_token",
    "auth_token",
    "client_secret",
    "refresh_token",
    "Authorization",
    "bearer",
  ];

  for (const alias of aliases) {
    const input = internalMcp();
    input.entry = {
      kind: "mcp_endpoint",
      value: `https://mcp.example.test/servers/docs?${alias}=not-a-real-secret`,
    };

    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("session/ID token and cloud presigned-URL signature spellings in an MCP endpoint are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const aliases = [
    "session_token",
    "id_token",
    "security_token",
    "sas_token",
    "signature",
    "sig",
    "X-Amz-Security-Token",
    "X-Amz-Signature",
    "X-Amz-Credential",
  ];

  for (const alias of aliases) {
    const input = internalMcp();
    input.entry = {
      kind: "mcp_endpoint",
      value: `https://mcp.example.test/servers/docs?${alias}=not-a-real-secret`,
    };

    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("OAuth client-assertion and webhook signing-secret spellings in an MCP endpoint are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const aliases = [
    "client_assertion",
    "consumer_secret",
    "oauth_token_secret",
    "webhook_secret",
    "signing_secret",
    "private_token",
  ];

  for (const alias of aliases) {
    const input = internalMcp();
    input.entry = {
      kind: "mcp_endpoint",
      value: `https://mcp.example.test/servers/docs?${alias}=not-a-real-secret`,
    };

    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("any query key ending in a secret-shaped suffix is rejected in an MCP endpoint, not just the literal spellings on the deny list", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  // None of these exact compound names are on the historical literal deny list,
  // but each ends in a word (token / secret / credential / apikey) that is.
  const aliases = [
    "shared_secret",
    "renewal_token",
    "personal_access_token",
    "device_secret",
    "vault_credential",
    "partner_apikey",
  ];

  for (const alias of aliases) {
    const input = internalMcp();
    input.entry = {
      kind: "mcp_endpoint",
      value: `https://mcp.example.test/servers/docs?${alias}=not-a-real-secret`,
    };

    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret values in an MCP endpoint query are rejected even when the key name is innocuous", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const values = [
    "sk-live-not-a-real-secret",
    "ghp_notARealGitHubToken1",
    "github_pat_notARealGitHubToken1",
    "glpat-not-a-real-gitlab",
    "xoxb-not-a-real-slack",
    "sk_test_notARealStripeKey",
    "AKIANOTAREALAWSKEY01",
    "ASIANOTAREALSTSKEY01",
    "AIzaSyNOTAREALGOOGLEAPIKEY0123456789abc",
    "npm_NOTAREALTOKEN0123456789abcdefghijklm",
  ];

  for (const value of values) {
    const input = internalMcp();
    input.entry = {
      kind: "mcp_endpoint",
      value: `https://mcp.example.test/servers/docs?ref=${value}`,
    };

    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secrets in an MCP endpoint fragment are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const hrefs = [
    "https://mcp.example.test/servers/docs#access_token=not-a-real-secret",
    "https://mcp.example.test/servers/docs#ref=sk-live-not-a-real-secret",
    "https://mcp.example.test/servers/docs#state=ok&id_token=not-a-real-secret",
  ];

  for (const href of hrefs) {
    const input = internalMcp();
    input.entry = { kind: "mcp_endpoint", value: href };
    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("MCP endpoint documentation fragment and a path named token still register", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const input = internalMcp();
  input.entry = {
    kind: "mcp_endpoint",
    value: "https://mcp.example.test/auth/token#installation",
  };

  const created = await service.register(maintainer, input);
  assertEquals(created.entry.value, "https://mcp.example.test/auth/token#installation");
});

Deno.test("plaintext secret value in an MCP endpoint path is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const hrefs = [
    "https://mcp.example.test/servers/sk-live-not-a-real-secret-0123456789",
    "https://mcp.example.test/connect/ghp_notARealGitHubToken1234567890",
    "https://mcp.example.test/keys/AKIANOTAREALAWSKEY01",
    "https://mcp.example.test/keys/AIzaSyNOTAREALGOOGLEAPIKEY0123456789abc",
    "https://mcp.example.test/keys/npm_NOTAREALTOKEN0123456789abcdefghijklm",
  ];

  for (const href of hrefs) {
    const input = internalMcp();
    input.entry = { kind: "mcp_endpoint", value: href };
    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("MCP endpoint userinfo is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.entry = {
    kind: "mcp_endpoint",
    value: "https://user:pass@mcp.example.test/servers/docs",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("command-style MCP endpoint is rejected so Portico cannot become a runtime", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalMcp();
  input.entry = { kind: "mcp_endpoint", value: "npx -y @example/docs-mcp" };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assertEquals(await store.list(), []);
});

Deno.test("anonymous cannot list or describe an internal MCP surface", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalMcp());

  assertEquals(await service.listMcp(anonymous), []);
  await assertRejectsCode(() => service.describeMcp(anonymous, "docs-mcp"), "NOT_FOUND");
});

Deno.test("pending public MCP stays hidden from anonymous; approve then describe matches", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalMcp());
  await service.publish(maintainer, { id: "docs-mcp", visibility: "public" });

  assertEquals(await service.listMcp(anonymous), []);
  await assertRejectsCode(() => service.describeMcp(anonymous, "docs-mcp"), "NOT_FOUND");

  const readerPending = await service.describeMcp(reader, "docs-mcp");
  assertEquals(readerPending.governanceState, "pending_public");
  assertEquals(readerPending.endpoint.value, MCP_ENDPOINT);

  const approved = await service.approve(auditor, { id: "docs-mcp" });
  assertEquals(approved.governanceState, "approved_public");

  const listed = await service.listMcp(anonymous);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-mcp");
  assertEquals(listed[0].governanceState, "approved_public");
  const described = await service.describeMcp(anonymous, "docs-mcp");
  assertEquals(described.endpoint.value, MCP_ENDPOINT);
  assertEquals(described.connect.mode, "direct");
});

Deno.test("describeMcp does not mutate the catalog", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  await service.register(maintainer, internalMcp());
  const before = JSON.stringify(await store.list());

  await service.describeMcp(reader, "docs-mcp");
  await service.listMcp(reader);

  assertEquals(JSON.stringify(await store.list()), before);
});

Deno.test("file store rejected MCP secret endpoint leaves catalog file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-mcp-" });
  const path = `${dir}/catalog.json`;
  const service = new CatalogService(new FileCatalogStore(path));
  const input = internalMcp();
  input.entry = {
    kind: "mcp_endpoint",
    value: "https://mcp.example.test/servers/docs?api_key=not-a-real-key",
  };

  await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  assert(!(await fileExists(path)), "failed MCP register must not create the catalog file");
});
