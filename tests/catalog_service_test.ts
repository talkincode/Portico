import { assert, assertEquals, assertRejectsCode } from "./assert.ts";
import {
  type Actor,
  CatalogService,
  MemoryCatalogStore,
  type RegisterInput,
} from "../src/catalog/mod.ts";

const maintainer: Actor = {
  id: "agent:docs-bot",
  kind: "agent",
  role: "maintainer",
};

const reader: Actor = {
  id: "human:auditor",
  kind: "human",
  role: "reader",
};

const anonymous: Actor = {
  id: "anonymous",
  kind: "human",
  role: "anonymous",
};

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

Deno.test("maintainer can register an internal surface and reader can see it", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, internalCli());

  assertEquals(created.id, "docs-writer");
  assertEquals(created.visibility, "internal");
  assertEquals(created.governanceState, "internal");
  assertEquals(created.channels, ["cli"]);
  assertEquals(created.entry.value, "jsr:@example/docs-writer");

  const listed = await service.list(reader);
  assertEquals(listed.length, 1);
  assertEquals(listed[0].id, "docs-writer");
  assertEquals(listed[0].name, "Docs Writer");

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.governanceState, "internal");
  assertEquals(got.visibility, "internal");
});

Deno.test("reader cannot register; catalog stays empty", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);

  await assertRejectsCode(
    () => service.register(reader, internalCli()),
    "FORBIDDEN",
  );

  assertEquals(await service.list(maintainer), []);
  assertEquals(await store.list(), []);
});

Deno.test("registering public visibility is rejected and does not dirty the catalog", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.visibility = "public";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "PUBLIC_REQUIRES_APPROVAL",
  );

  assertEquals(await store.list(), []);
  await assertRejectsCode(
    () => service.get(anonymous, "docs-writer"),
    "NOT_FOUND",
  );
});

Deno.test("sneaking approved_public governance state is rejected", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const sneaky = {
    ...internalCli(),
    governanceState: "approved_public",
  } as RegisterInput;

  await assertRejectsCode(
    () => service.register(maintainer, sneaky),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("duplicate id fails and original record is unchanged", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  const second = internalCli();
  second.name = "Hijacked Name";

  await assertRejectsCode(
    () => service.register(maintainer, second),
    "ALREADY_EXISTS",
  );

  const got = await service.get(reader, "docs-writer");
  assertEquals(got.name, "Docs Writer");
});

Deno.test("anonymous cannot see internal records", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  await service.register(maintainer, internalCli());

  assertEquals(await service.list(anonymous), []);
  await assertRejectsCode(
    () => service.get(anonymous, "docs-writer"),
    "NOT_FOUND",
  );
});

Deno.test("invalid id is rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = internalCli();
  input.id = "Docs Writer";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret fields are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  const input = {
    ...internalCli(),
    token: "sk-live-not-a-real-secret",
  } as RegisterInput;

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "INVALID_INPUT",
  );
  assertEquals(await store.list(), []);
});

Deno.test("plaintext secret values in name, description, or version are rejected with no write", async () => {
  const store = new MemoryCatalogStore();
  const service = new CatalogService(store);
  // name/description/version are free text rendered on public cards and
  // detail pages once approved. A live credential pasted anywhere inside
  // them is as much a public leak as one in an entry URL, even though it
  // is not anchored at the start of the field.
  const cases: Array<Partial<RegisterInput>> = [
    { name: "sk-live-not-a-real-secret-0123456789" },
    { description: "Uses key ghp_notARealGitHubToken1234567890 to call the API." },
    { version: "glpat-not-a-real-gitlab-01234" },
    // The remaining issuer-prefix families share the same substring scanner
    // as sk-/ghp_/glpat- above; each one needs its own case or a future
    // change to the shared prefix list could silently drop a family without
    // any test noticing.
    { description: "Rotate gho_notARealGitHubToken1234567890 before shipping." },
    { name: "ghu_notARealGitHubToken1234567890" },
    { version: "ghs_notARealGitHubToken1234567890" },
    { description: "Server token ghr_notARealGitHubToken1234567890 leaked in logs." },
    { name: "github_pat_notARealGitHubToken1234567890" },
    { description: "Slack webhook uses xoxb-not-a-real-slack-01234567890." },
    // AWS Access Key IDs are named in docs/security/secrets.md as a plaintext
    // class to refuse. They are 20-char uppercase ids (AKIA long-lived, ASIA
    // temporary). A description that only says "asia-pacific" is not a key.
    { name: "AKIANOTAREALAWSKEY01" },
    { description: "Rotate ASIANOTAREALSTSKEY01 after the incident." },
    // Google API keys are a fixed-shape `AIza` + 35 base64url-alphabet
    // characters (39 total). Unlike the issuer-prefix family above, the
    // shape is defined by exact length, not a trailing-character minimum.
    { name: "AIzaSyDaGmWKa4JsXZHjGw7ISLn3namBGewQeX1" },
    { description: "Maps key AIzaSyDaGmWKa4JsXZHjGw7ISLn3namBGewQeX1 is live." },
    // A PEM private-key header is a leak regardless of which key type
    // follows it or where in the field it appears.
    { name: "-----BEGIN PRIVATE KEY-----" },
    { description: "Rotate this: -----BEGIN RSA PRIVATE KEY----- MIIE..." },
    { version: "-----BEGIN OPENSSH PRIVATE KEY-----" },
  ];

  for (const fields of cases) {
    const input = { ...internalCli(), ...fields };
    await assertRejectsCode(() => service.register(maintainer, input), "INVALID_INPUT");
  }
  assertEquals(await store.list(), []);
});

Deno.test("asia-pacific names and a bare AKIA mention are not access key ids", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, {
    ...internalCli(),
    name: "Asia-Pacific Docs Writer",
    description: "Serves the asia-pacific region. Never paste an AKIA key here.",
  });
  assertEquals(created.name, "Asia-Pacific Docs Writer");
});

Deno.test("prose mentioning private keys or a short AIza-looking token without the real shape is not rejected", async () => {
  const service = new CatalogService(new MemoryCatalogStore());
  const created = await service.register(maintainer, {
    ...internalCli(),
    name: "Key Rotation Docs",
    description:
      "Explains our private key rotation policy. Sample prefix only: AIzaShort, not a real key.",
  });
  assertEquals(created.name, "Key Rotation Docs");
});

Deno.test("file store failed public register leaves catalog file absent", async () => {
  const dir = await Deno.makeTempDir({ prefix: "portico-catalog-" });
  const path = `${dir}/catalog.json`;
  const { FileCatalogStore } = await import("../src/catalog/mod.ts");
  const store = new FileCatalogStore(path);
  const service = new CatalogService(store);
  const input = internalCli();
  input.visibility = "public";

  await assertRejectsCode(
    () => service.register(maintainer, input),
    "PUBLIC_REQUIRES_APPROVAL",
  );

  let present = true;
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) present = false;
    else throw error;
  }
  assert(!present, "failed public register must not create the catalog file");
});
