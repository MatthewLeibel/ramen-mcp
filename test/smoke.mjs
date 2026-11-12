// Live check of the connector against RAMen, the way an app uses it: start it, initialize, list the tools, call two
// read-only tools, close it; then again to see the saved sign-in reused, and once with a wrong key.
//   RAMEN_LICENSE_KEY=... node test/smoke.mjs      (the key is never printed)
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "ramen-mcp.js");
const TOOLS = ["recall", "remember", "forget", "memory_status", "save_thread", "resume_thread", "recall_thread"];
let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${what}`);
  if (!ok) { failures++; if (detail) console.log("      ", String(detail).slice(0, 300)); }
};

function run(env, messages, { waitFor = [] } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BIN], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const got = new Map();
    let buf = "", err = "";
    p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.id !== undefined) got.set(m.id, m); } catch { got.set("bad", line); }
        if (waitFor.every((id) => got.has(id))) p.stdin.end();
      }
    });
    p.stderr.on("data", (d) => { err += d; });
    p.on("exit", (code) => resolve({ code, got, err }));
    for (const m of messages) p.stdin.write(JSON.stringify(m) + "\n");
    setTimeout(() => p.kill(), 60000);
  });
}

const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {},
  clientInfo: { name: "claude-code", version: "test" } } };
const msgs = [init, { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory_status", arguments: {} } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "recall", arguments: { question: "What do you know about me?" } } }];

if (!process.env.RAMEN_LICENSE_KEY) { console.log("Set RAMEN_LICENSE_KEY first (a RAMen license key)."); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), "ramen-mcp-test-"));
try {
  const a = await run({ XDG_CONFIG_HOME: dir, RAMEN_DEBUG: "1" }, msgs, { waitFor: [1, 2, 3, 4] });
  const r1 = a.got.get(1), r2 = a.got.get(2), r3 = a.got.get(3), r4 = a.got.get(4);
  check(r1 && r1.result && r1.result.serverInfo, "initialize answered by RAMen", JSON.stringify(r1 || a.err));
  const names = ((r2 && r2.result && r2.result.tools) || []).map((t) => t.name);
  check(TOOLS.every((t) => names.includes(t)), `tools/list has RAMen's 7 tools (${names.length} listed)`, names.join(", "));
  const text = (r) => ((r && r.result && r.result.content) || []).map((c) => c.text || "").join(" ");
  check(r3 && r3.result && !r3.result.isError && text(r3).length > 20, "memory_status answers", JSON.stringify(r3));
  check(r4 && r4.result && !r4.result.isError && text(r4).length > 20, "recall answers", JSON.stringify(r4));
  check(!a.got.has("bad"), "stdout carries only JSON-RPC messages");
  check(/signed in to RAMen/.test(a.err), "first start signs in");
  check(a.code === 0, `exits cleanly when the app closes it (code ${a.code})`);

  const b = await run({ XDG_CONFIG_HOME: dir, RAMEN_DEBUG: "1" }, msgs.slice(0, 3), { waitFor: [1, 2] });
  check(b.got.get(2) && b.got.get(2).result, "second start works");
  check(!/signed in to RAMen/.test(b.err), "second start reuses the saved sign-in (no new sign-in)", b.err);

  const c = await run({ XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "ramen-mcp-bad-")), RAMEN_LICENSE_KEY: "not-a-real-key" },
    msgs.slice(0, 1), { waitFor: [1] });
  const e = c.got.get(1);
  check(e && e.error && /sign-in failed|license|key/i.test(e.error.message), "a wrong key gets a clear error, not a hang",
    JSON.stringify(e));
  const n = await run({ XDG_CONFIG_HOME: dir, RAMEN_LICENSE_KEY: "" }, [msgs[0], msgs[2], msgs[3]], { waitFor: [1, 2, 3] });
  const nt = ((n.got.get(2) && n.got.get(2).result && n.got.get(2).result.tools) || []).map((t) => t.name);
  check(n.got.get(1) && n.got.get(1).result && TOOLS.every((t) => nt.includes(t)), "without a key: starts and lists the 7 tools");
  const nc = n.got.get(3);
  check(nc && nc.result && nc.result.isError && /RAMEN_LICENSE_KEY/.test(JSON.stringify(nc.result)),
    "without a key: a tool call asks for the key", JSON.stringify(nc));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
