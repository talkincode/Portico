import { assert, assertEquals } from "./assert.ts";
import { CatalogError, ErrorCode } from "../src/catalog/mod.ts";
import { parseBindHostname, parseBindPort, readBind } from "../src/runtime/bind.ts";

function assertBindRejected(value: string | undefined): void {
  try {
    parseBindHostname(value);
  } catch (error) {
    if (!(error instanceof CatalogError)) {
      throw new Error(`expected CatalogError for ${value}`);
    }
    assertEquals(error.code, ErrorCode.USAGE);
    return;
  }
  throw new Error(`expected PORTICO_BIND ${JSON.stringify(value)} to be rejected`);
}

Deno.test("parseBindHostname defaults to loopback", () => {
  assertEquals(parseBindHostname(undefined), "127.0.0.1");
  assertEquals(parseBindHostname("127.0.0.1"), "127.0.0.1");
  assertEquals(parseBindHostname("localhost"), "localhost");
});

Deno.test("parseBindHostname allows RFC1918 unicast addresses", () => {
  assertEquals(parseBindHostname("10.0.0.1"), "10.0.0.1");
  assertEquals(parseBindHostname("10.255.255.254"), "10.255.255.254");
  assertEquals(parseBindHostname("172.16.0.1"), "172.16.0.1");
  assertEquals(parseBindHostname("172.31.255.254"), "172.31.255.254");
  assertEquals(parseBindHostname("192.168.0.1"), "192.168.0.1");
  assertEquals(parseBindHostname("192.168.1.10"), "192.168.1.10");
  assertEquals(parseBindHostname("192.168.255.254"), "192.168.255.254");
});

Deno.test("parseBindHostname refuses wildcard, IPv6, and public addresses", () => {
  for (
    const value of [
      "0.0.0.0",
      "::",
      "::1",
      "8.8.8.8",
      "1.1.1.1",
      "11.0.0.1",
      "172.15.255.1",
      "172.32.0.1",
      "192.169.0.1",
      "169.254.1.1",
      "224.0.0.1",
      "255.255.255.255",
      "example.com",
      "",
      " 10.0.0.1",
      "10.0.0.1 ",
      "010.0.0.1",
      "::ffff:10.0.0.1",
    ]
  ) {
    assertBindRejected(value);
  }
});

Deno.test("parseBindPort accepts 0-65535 and rejects other values", () => {
  assertEquals(parseBindPort(undefined, 8788), 8788);
  assertEquals(parseBindPort("8789", 8788), 8789);
  assertEquals(parseBindPort("0", 8788), 0);
  assertEquals(parseBindPort("65535", 8788), 65535);
  try {
    parseBindPort("65536", 8788);
    throw new Error("expected port 65536 to be rejected");
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    assertEquals(error.code, ErrorCode.USAGE);
  }
});

Deno.test("readBind uses PORTICO_BIND and PORTICO_PORT together", () => {
  assertEquals(readBind({}, 8788), { hostname: "127.0.0.1", port: 8788 });
  assertEquals(
    readBind({ PORTICO_BIND: "192.168.1.10", PORTICO_PORT: "8788" }, 8788),
    { hostname: "192.168.1.10", port: 8788 },
  );
});

Deno.test("deno.json default tasks still only allow 127.0.0.1", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks: Record<string, string> };
  for (const name of ["test", "portal", "gateway"]) {
    const task = config.tasks[name];
    assert(task.includes("--allow-net=127.0.0.1"), `${name} must allow 127.0.0.1`);
    assert(
      !/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
        .test(task),
      `${name} must not bake an RFC1918 bind into the default task`,
    );
    assert(!task.includes("0.0.0.0"), `${name} must not allow 0.0.0.0`);
    assert(!task.includes("--allow-all"), `${name} must not use --allow-all`);
  }
  assert(!config.tasks.portal.includes("--allow-write"), "portal must not have --allow-write");
});
