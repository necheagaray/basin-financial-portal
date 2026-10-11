// Password gate for the Basin Financial Portal.
//
// Runs on Netlify in front of every page, file and function on the site, so
// nothing -- the portal, portal-data.json, the shared Pending Contracts list --
// is served until the shared password has been entered once on that browser.
// After that a sign-in cookie keeps the browser in for 30 days.
//
// Only a fingerprint (SHA-256) of the password is stored here, never the
// password itself. To change the password, set an environment variable in
// Netlify called PORTAL_PASSWORD_SHA256 to the new fingerprint (everyone will
// be asked to sign in again).

const DEFAULT_HASH = "5d2ab891837a4b543a97d195b9fe5e550fae060fd04b3aa83f7d59ae76fc330c";
const COOKIE = "basin_portal_auth";
const MAX_AGE = 60 * 60 * 24 * 30;            // 30 days
const LOGIN_PATH = "/__portal-login";

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function expectedHash() {
  try {
    const v = typeof Netlify !== "undefined" && Netlify.env && Netlify.env.get("PORTAL_PASSWORD_SHA256");
    if (v && /^[0-9a-f]{64}$/i.test(v.trim())) return v.trim().toLowerCase();
  } catch (_) {}
  return DEFAULT_HASH;
}
// The cookie holds a token derived from the password fingerprint, so changing
// the password signs everyone out.
async function sessionToken() { return sha256(expectedHash() + ":basin-portal-session:v1"); }
function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}
function safeNext(n) {
  return typeof n === "string" && n.startsWith("/") && !n.startsWith("//") && !n.startsWith(LOGIN_PATH) ? n : "/";
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function loginPage(next, error) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Basin Financial Portal · Sign in</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:'Helvetica Neue',Arial,sans-serif;color:#e8f2ff;
    background:radial-gradient(80% 60% at 50% 0%,rgba(0,212,255,.16),transparent 60%),
      radial-gradient(60% 50% at 80% 100%,rgba(255,61,216,.12),transparent 60%),#05070f}
  .card{width:min(400px,100%);padding:34px 30px 28px;border-radius:18px;text-align:center;
    background:rgba(10,16,32,.86);border:1px solid rgba(0,212,255,.3);
    box-shadow:0 30px 80px -30px rgba(0,0,0,.9),0 0 40px -16px rgba(0,212,255,.45)}
  .mark{width:58px;height:58px;margin:0 auto 14px;color:#4a78a8;background:#e8eef6;border-radius:6px;
    display:flex;align-items:center;justify-content:center}
  h1{margin:0;font-size:22px;letter-spacing:4px;font-weight:800}
  h1 b{color:#00d4ff}
  p{margin:8px 0 22px;font-size:11px;letter-spacing:3px;color:#7fa3c8;text-transform:uppercase}
  input{width:100%;padding:13px 14px;border-radius:10px;border:1px solid rgba(0,212,255,.35);
    background:rgba(0,0,0,.35);color:#fff;font-size:15px;outline:none}
  input:focus{border-color:#00d4ff;box-shadow:0 0 0 3px rgba(0,212,255,.18)}
  button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:10px;cursor:pointer;
    font-size:12px;font-weight:800;letter-spacing:2px;color:#03101f;background:linear-gradient(90deg,#00d4ff,#7be7ff)}
  .err{margin-top:12px;font-size:12px;color:#ff8a95;min-height:16px}
  .show{display:flex;align-items:center;gap:7px;justify-content:flex-start;margin-top:10px;font-size:11.5px;color:#7fa3c8}
  .show input{width:auto}
</style></head><body>
<form class="card" method="post" action="${LOGIN_PATH}">
  <div class="mark"><svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M5 4H33Q36 4 36 7V11H31V9H10V31H31V29H36V33Q36 36 33 36H5Z" fill="currentColor"/>
    <path fill-rule="evenodd" fill="currentColor" d="M14 12H25Q30 12 30 16.5Q30 19 28 20Q31 21.2 31 24Q31 28 26 28H14ZM18 15.5V18.5H24.5Q26 18.5 26 17T24.5 15.5ZM18 21.5V24.5H25.5Q27 24.5 27 23T25.5 21.5Z"/></svg></div>
  <h1>BASIN <b>PORTAL</b></h1>
  <p>Business intelligence · sign in</p>
  <input type="password" name="password" id="pw" placeholder="Password" autocomplete="current-password" autofocus required>
  <label class="show"><input type="checkbox" onclick="document.getElementById('pw').type=this.checked?'text':'password'">Show password</label>
  <input type="hidden" name="next" value="${esc(next)}">
  <button type="submit">ENTER PORTAL</button>
  <div class="err">${error ? "That password isn\u2019t right. Try again." : ""}</div>
</form></body></html>`;
  return new Response(html, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export default async (req, context) => {
  const url = new URL(req.url);
  const token = await sessionToken();

  // Sign-in form posts here.
  if (url.pathname === LOGIN_PATH) {
    if (req.method !== "POST") return loginPage("/", false);
    const form = await req.formData();
    const next = safeNext(String(form.get("next") || "/"));
    const ok = (await sha256(String(form.get("password") || ""))) === expectedHash();
    if (!ok) {
      await new Promise((r) => setTimeout(r, 600));   // slow down guessing
      return loginPage(next, true);
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: next,
        "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
      },
    });
  }

  if (readCookie(req, COOKIE) === token) return context.next();

  // Not signed in: pages get the sign-in screen; data and API calls get a
  // plain 401 so nothing leaks.
  const wantsPage = req.method === "GET" && (req.headers.get("accept") || "").includes("text/html");
  if (wantsPage) return loginPage(url.pathname + url.search, false);
  return new Response('{"error":"sign in required"}', {
    status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};

export const config = { path: "/*" };
