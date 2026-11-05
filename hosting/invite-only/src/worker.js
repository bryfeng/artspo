// Serves ./site only to visitors signed in through Cloudflare Access.
//
// Access sits in front of this Worker and does the sign-in. The Worker checks Access's signed token on every
// request anyway, so if the Access application is ever removed or misconfigured the site closes instead of
// going public. Until ACCESS_TEAM_DOMAIN and ACCESS_AUD are set, everything is closed.

const CERTS_TTL_MS = 60 * 60 * 1000;
const SKEW_S = 60;
let certs = { at: 0, team: "", keys: [] };

export default {
  async fetch(request, env) {
    const team = (env.ACCESS_TEAM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const aud = (env.ACCESS_AUD || "").trim();
    if (!team || !aud) return closed(503, "This site isn't open yet.");
    const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
    if (!token) return closed(403, "Sign in to see this site.");
    const claims = await verify(token, team, aud).catch(() => null);
    if (!claims) return closed(403, "Sign in to see this site.");
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-cache");
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    out.headers.set("Referrer-Policy", "same-origin");
    return out;
  },
};

export async function verify(token, team, aud, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const header = json(parts[0]);
  const claims = json(parts[1]);
  if (header.alg !== "RS256") throw new Error("alg");
  const key = (await keys(team, now)).find((k) => k.kid === header.kid);
  if (!key) throw new Error("kid");
  const pub = await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error("signature");
  const t = now / 1000;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw new Error("aud");
  if (claims.iss !== `https://${team}`) throw new Error("iss");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < t) throw new Error("exp");
  if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > t) throw new Error("nbf");
  return claims;
}

async function keys(team, now) {
  if (certs.team === team && now - certs.at < CERTS_TTL_MS && certs.keys.length) return certs.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = await res.json();
  certs = { at: now, team, keys: body.keys || [] };
  return certs.keys;
}

function b64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function json(s) {
  return JSON.parse(new TextDecoder().decode(b64url(s)));
}

function cookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : "";
}

function closed(status, message) {
  const page = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${message}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#fbfaf7;color:#17161a">
<p>${message}</p></body>`;
  return new Response(page, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  });
}
