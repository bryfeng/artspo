// node --test hosting/invite-only/test/  (Node 20+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const TEAM = "artbook.cloudflareaccess.com";
const AUD = "aud-tag-123";
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "RS256" };

let certFetches = 0;
globalThis.fetch = async (url) => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  certFetches++;
  return new Response(JSON.stringify({ keys: [jwk] }));
};

async function token(claims = {}, { key = pair.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg, kid, typ: "JWT" })}.${enc({ aud: [AUD], iss: `https://${TEAM}`, exp: now + 600, iat: now, email: "a@b.c", ...claims })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

const env = (extra = {}) => ({
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
  ASSETS: { fetch: async () => new Response("<h1>book</h1>", { headers: { "Content-Type": "text/html" } }) },
  ...extra,
});
const req = (headers = {}) => new Request("https://studio.artbook.dev/ov/", { headers });
const run = (r, e = env()) => worker.fetch(r, e);

test("closed until configured", async () => {
  const r = await run(req({ "Cf-Access-Jwt-Assertion": await token() }), env({ ACCESS_AUD: "" }));
  assert.equal(r.status, 503);
});

test("no token: closed", async () => {
  assert.equal((await run(req())).status, 403);
});

test("valid token in header: serves the site, privately", async () => {
  const r = await run(req({ "Cf-Access-Jwt-Assertion": await token() }));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "<h1>book</h1>");
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(r.headers.get("Cache-Control"), /private/);
});

test("valid token in cookie only: serves", async () => {
  const r = await run(req({ Cookie: `foo=1; CF_Authorization=${await token()}` }));
  assert.equal(r.status, 200);
});

test("team domain given as a URL still works", async () => {
  const r = await run(req({ "Cf-Access-Jwt-Assertion": await token() }), env({ ACCESS_TEAM_DOMAIN: `https://${TEAM}/` }));
  assert.equal(r.status, 200);
});

for (const [name, make] of [
  ["another application's token", () => token({ aud: ["someone-else"] })],
  ["expired", () => token({ exp: Math.floor(Date.now() / 1000) - 3600 })],
  ["not yet valid", () => token({ nbf: Math.floor(Date.now() / 1000) + 3600 })],
  ["another team", () => token({ iss: "https://evil.cloudflareaccess.com" })],
  ["signed by another key", () => token({}, { key: other.privateKey })],
  ["unknown key id", () => token({}, { kid: "k9" })],
  ["alg none", async () => { const t = await token({}, { alg: "none" }); return t; }],
  ["garbage", async () => "a.b"],
]) {
  test(`rejects: ${name}`, async () => {
    const r = await run(req({ "Cf-Access-Jwt-Assertion": await make() }));
    assert.equal(r.status, 403);
  });
}

test("certs are cached between requests", async () => {
  const before = certFetches;
  await run(req({ "Cf-Access-Jwt-Assertion": await token() }));
  await run(req({ "Cf-Access-Jwt-Assertion": await token() }));
  assert.equal(certFetches, before);
});
