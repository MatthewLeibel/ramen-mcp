#!/usr/bin/env node
// RAMen connector: a local MCP server (stdio) for apps that run MCP servers on your computer. It signs in to RAMen
// with your license key and passes every MCP message to RAMen's hosted server, where all of RAMen runs.
// No dependencies. MIT License. https://getramenai.com
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const VERSION = "1.0.0";
const BASE = (process.env.RAMEN_SERVER || "https://ramen-online.matthewsleibel.workers.dev").replace(/\/+$/, "");
const MCP_URL = `${BASE}/mcp`;
const REDIRECT = "http://localhost/ramen-mcp/callback";
const KEY = (process.env.RAMEN_LICENSE_KEY || process.env.RAMEN_KEY || "").trim();
const DEBUG = !!process.env.RAMEN_DEBUG;
const UA = `ramen-mcp/${VERSION}`;
// what an app calls itself in MCP, and the name RAMen shows on the receipts of notes saved from it
const KNOWN = { "claude-ai": "Claude Desktop", "claude-code": "Claude Code", cursor: "Cursor", "cursor-vscode": "Cursor",
  "visual studio code": "VS Code", vscode: "VS Code", windsurf: "Windsurf", zed: "Zed", cline: "Cline", "roo-code": "Roo Code",
  codex: "Codex", "codex-mcp-client": "Codex", "gemini-cli-mcp-client": "Gemini CLI", goose: "Goose", continue: "Continue" };

const log = (...a) => process.stderr.write(`[ramen-mcp] ${a.join(" ")}\n`);
const debug = (...a) => DEBUG && log(...a);
const out = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let app = (process.env.RAMEN_APP || "").trim().slice(0, 60);
let session = null;            // { clientId, accessToken, refreshToken, expiresAt }
let mcpSession = null;         // Mcp-Session-Id from RAMen
let protocol = null;           // the MCP version agreed at initialize
let initMsg = null;            // the app's initialize, kept to start a new session if RAMen's expires
let ready = null;              // resolves once initialize has been answered
let signingIn = null;

function appName(clientInfo) {
  if (app) return app;
  const raw = String((clientInfo && (clientInfo.title || clientInfo.name)) || "").trim();
  const name = KNOWN[raw.toLowerCase()] || raw || "RAMen connector";
  return name.replace(/[\u0000-\u001f]/g, "").slice(0, 60);
}

function configDir() {
  const base = process.env.XDG_CONFIG_HOME || (platform() === "win32" && process.env.APPDATA) || join(homedir(), ".config");
  return join(base, "ramen-mcp");
}
const sessionFile = () => join(configDir(),
  `session-${createHash("sha256").update(`${BASE}\n${app}\n${KEY}`).digest("hex").slice(0, 16)}.json`);

function loadSession() {
  try { return JSON.parse(readFileSync(sessionFile(), "utf8")); } catch { return null; }
}
function saveSession() {
  try {
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(sessionFile(), JSON.stringify(session), { mode: 0o600 });
    chmodSync(sessionFile(), 0o600);
  } catch (e) { debug("could not save the sign-in:", e.message); }
}

const decode = (s) => s.replace(/&#(\d+);/g, (m, c) => String.fromCharCode(+c))
  .replace(/&#x([0-9a-f]+);/gi, (m, c) => String.fromCharCode(parseInt(c, 16)))
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const pageText = (html) => decode(String(html).replace(/<(head|script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function cookiesOf(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie()
    : String(res.headers.get("set-cookie") || "").split(/,(?=\s*[^;,=\s]+=)/).filter(Boolean);
  return list.map((c) => c.split(";")[0].trim()).join("; ");
}

async function token(params) {
  const res = await fetch(`${BASE}/oauth/token`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ ...params, resource: MCP_URL }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`RAMen did not issue a sign-in (${res.status} ${body.error || ""})`.trim());
  return { accessToken: body.access_token, refreshToken: body.refresh_token || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
}

async function register() {
  const res = await fetch(`${BASE}/oauth/register`, { method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ client_name: app, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) throw new Error(`RAMen did not accept the connector (${res.status})`);
  return body.client_id;
}

/** RAMen's own sign-in, the same one a browser shows: the license key goes only to RAMen. */
async function signIn(clientId) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", state: b64url(randomBytes(12)), resource: MCP_URL });
  const page = await fetch(`${BASE}/authorize?${q}`, { redirect: "manual", headers: { "User-Agent": UA } });
  const html = await page.text();
  const handle = (html.match(/name="handle" value="([^"]+)"/) || [])[1];
  if (page.status !== 200 || !handle) {
    const err = new Error(`RAMen's sign-in page did not open (${page.status})`);
    err.badClient = page.status === 400;
    throw err;
  }
  const done = await fetch(`${BASE}/authorize`, { method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookiesOf(page), Origin: BASE, "User-Agent": UA },
    body: new URLSearchParams({ handle: decode(handle), key: KEY, decision: "approve" }) });
  const loc = done.headers.get("location");
  const code = loc ? new URL(loc, BASE).searchParams.get("code") : null;
  if (done.status !== 302 || !code) {
    const text = pageText(await done.text());
    const why = text.replace(/^Could not connect\s*/i, "").replace(/\s*Go back to the app and connect again\.?\s*$/i, "");
    throw new Error(`RAMen sign-in failed: ${why.slice(0, 300) || done.status} (RAMEN_LICENSE_KEY in your app's MCP settings)`);
  }
  return token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
}

async function fullSignIn() {
  let clientId = session && session.clientId;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!clientId) clientId = await register();
    try {
      session = { clientId, ...(await signIn(clientId)) };
      saveSession();
      debug(`signed in to RAMen as "${app}"`);
      return;
    } catch (e) {
      if (!e.badClient || attempt) throw e;
      clientId = null;                 // the saved registration is gone: register again
    }
  }
}

async function accessToken(force = false) {
  if (!KEY) throw new Error("Set RAMEN_LICENSE_KEY to your RAMen license key (free at https://getramenai.com).");
  if (!session) session = loadSession();
  if (!force && session && session.accessToken && session.expiresAt - 60000 > Date.now()) return session.accessToken;
  if (signingIn) { await signingIn; return session.accessToken; }
  signingIn = (async () => {
    if (session && session.refreshToken) {
      try {
        session = { clientId: session.clientId, ...(await token({ grant_type: "refresh_token",
          refresh_token: session.refreshToken, client_id: session.clientId })) };
        saveSession();
        debug("sign-in refreshed");
        return;
      } catch (e) { debug("refresh failed, signing in again:", e.message); }
    }
    await fullSignIn();
  })();
  try { await signingIn; } finally { signingIn = null; }
  return session.accessToken;
}

/** Sends one MCP message to RAMen and passes what comes back to the app (forward=false keeps it here). */
async function post(msg, { forward = true, retry = true } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "User-Agent": UA,
    Authorization: `Bearer ${await accessToken()}` };
  if (mcpSession) headers["Mcp-Session-Id"] = mcpSession;
  if (protocol) headers["MCP-Protocol-Version"] = protocol;
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(msg) });
  if (res.status === 401 && retry) {
    await res.body?.cancel();
    await accessToken(true);
    return post(msg, { forward, retry: false });
  }
  if (res.status === 404 && mcpSession && msg.method !== "initialize" && retry) {
    await res.body?.cancel();
    await restart();
    return post(msg, { forward, retry: false });
  }
  if (msg.method === "initialize" && res.headers.get("mcp-session-id")) mcpSession = res.headers.get("mcp-session-id");
  if (res.status === 202 || res.status === 204) { await res.body?.cancel(); return []; }
  if (!res.ok) throw new Error(`RAMen answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const got = [];
  const take = (m) => {
    if (!m) return;
    if (msg.method === "initialize" && m.result && m.result.protocolVersion) protocol = m.result.protocolVersion;
    got.push(m);
    if (forward) out(m);
  };
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    const decoder = new TextDecoder();
    let buf = "";
    const flush = (block) => {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) { try { [].concat(JSON.parse(data)).forEach(take); } catch { debug("skipped a malformed event"); } }
    };
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        flush(buf.slice(0, i));
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      }
      if (msg.id !== undefined && got.some((m) => m.id === msg.id)) break;   // leaving the loop closes the stream
    }
    if (buf.trim()) flush(buf);
  } else {
    const text = await res.text();
    if (text.trim()) [].concat(JSON.parse(text)).forEach(take);
  }
  return got;
}

/** RAMen's session ended (it was idle): start a new one quietly, the way the app first did. */
async function restart() {
  mcpSession = null;
  protocol = null;
  debug("RAMen's session ended, starting a new one");
  await post({ ...initMsg, id: `ramen-mcp-restart-${Date.now()}` }, { forward: false, retry: false });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { forward: false, retry: false });
}

const pending = new Set();
async function handle(msg) {
  try {
    if (msg.method === "initialize") {
      initMsg = JSON.parse(JSON.stringify(msg));
      app = appName(msg.params && msg.params.clientInfo);
      let done;
      ready = new Promise((r) => { done = r; });
      try { await post(msg); } finally { done(); }
      return;
    }
    if (ready) await ready;
    await post(msg);
  } catch (e) {
    log(e.message);
    if (msg.id !== undefined && msg.method) out({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e.message } });
  }
}

if (process.argv.includes("--version")) { console.log(VERSION); process.exit(0); }
if (process.argv.includes("--help")) {
  console.log(`ramen-mcp ${VERSION}: RAMen's memory in any app that runs MCP servers on your computer.
Set RAMEN_LICENSE_KEY to your RAMen license key (free at https://getramenai.com) and add this command to your app's
MCP settings. Optional: RAMEN_APP (the app name on your notes' receipts), RAMEN_DEBUG=1 (more messages).`);
  process.exit(0);
}
if (!KEY) log("RAMEN_LICENSE_KEY is not set: get a free RAMen license key at https://getramenai.com");

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { log("ignored a line that is not JSON"); return; }
  for (const m of [].concat(msg)) {
    const p = handle(m);
    pending.add(p);
    p.finally(() => pending.delete(p));
  }
});
rl.on("close", async () => {
  await Promise.allSettled([...pending]);
  if (mcpSession && session) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    await fetch(MCP_URL, { method: "DELETE", signal: ctl.signal, headers: { "Mcp-Session-Id": mcpSession,
      Authorization: `Bearer ${session.accessToken}`, "User-Agent": UA } }).catch(() => {});
    clearTimeout(t);
  }
  process.exit(0);
});
