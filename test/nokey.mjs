// Offline check, no key and no network: the connector starts, answers initialize, lists RAMen's 7 tools from
// bin/tools.json, answers a tool call with a clear "add your key" message, keeps stdout to JSON-RPC and exits cleanly.
//   node test/nokey.mjs
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "ramen-mcp.js");
const TOOLS = ["recall", "remember", "forget", "memory_status", "save_thread", "resume_thread", "recall_thread"];
let failures = 0;
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} - ${what}`);
  if (!ok) { failures++; if (detail) console.log("      ", String(detail).slice(0, 300)); }
};

const env = { ...process.env };
delete env.RAMEN_LICENSE_KEY;
delete env.RAMEN_KEY;
const p = spawn(process.execPath, [BIN], { env, stdio: ["pipe", "pipe", "pipe"] });
const got = new Map();
let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); if (m.id !== undefined) got.set(m.id, m); } catch { got.set("bad", line); }
    if ([1, 2, 3].every((id) => got.has(id))) p.stdin.end();
  }
});
const timer = setTimeout(() => p.kill(), 20000);
const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ci", version: "test" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "memory_status", arguments: {} } });
const code = await new Promise((resolve) => p.on("exit", resolve));
clearTimeout(timer);

const r1 = got.get(1), r2 = got.get(2), r3 = got.get(3);
check(r1 && r1.result && r1.result.serverInfo, "initialize answered without a key", JSON.stringify(r1));
const names = ((r2 && r2.result && r2.result.tools) || []).map((t) => t.name);
check(TOOLS.every((t) => names.includes(t)), `tools/list has RAMen's 7 tools (${names.length} listed)`, names.join(", "));
const text = ((r3 && r3.result && r3.result.content) || []).map((c) => c.text || "").join(" ");
check(/RAMEN_LICENSE_KEY/.test(text), "a tool call asks for the license key", JSON.stringify(r3));
check(!got.has("bad"), "stdout carries only JSON-RPC messages", got.get("bad"));
check(code === 0, `exits cleanly when the app closes it (code ${code})`);
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
