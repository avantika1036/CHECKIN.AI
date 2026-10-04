// One-command local runner: `pnpm dev` (both servers) or `pnpm db:push` (create tables).
// Reads variables from a .env file in the project root; real shell variables win.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "artifacts", "api-server");
const webDir = path.join(root, "artifacts", "checkin-ai");
const dbDir = path.join(root, "lib", "db");

function loadEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const env = { ...loadEnvFile(path.join(root, ".env")), ...process.env };
const API_PORT = env.API_PORT || "5000";
const WEB_PORT = env.WEB_PORT || "5173";
const tag = (name, color) => (line) =>
  line.split(/\r?\n/).filter(Boolean).forEach((l) =>
    console.log(`\x1b[${color}m[${name}]\x1b[0m ${l}`));
const apiLog = tag("api", 36);
const webLog = tag("web", 33);

function need(file, hint) {
  if (!existsSync(file)) {
    console.error(`\nMissing ${path.relative(root, file)}.\n${hint}\n`);
    process.exit(1);
  }
}

function run(args, { cwd, env: e, log }) {
  const child = spawn(process.execPath, args, { cwd, env: e, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => log(String(d)));
  child.stderr.on("data", (d) => log(String(d)));
  return child;
}

const done = (child) => new Promise((resolve) => child.on("close", resolve));

if (!env.DATABASE_URL) {
  console.error("\nDATABASE_URL is not set. Copy .env.example to .env and fill it in.\n");
  process.exit(1);
}

if (process.argv[2] === "push") {
  const bin = path.join(dbDir, "node_modules", "drizzle-kit", "bin.cjs");
  need(bin, "Run `pnpm install` first.");
  const child = spawn(process.execPath, [bin, "push", "--config", "./drizzle.config.ts"], { cwd: dbDir, env, stdio: "inherit" });
  process.exit((await done(child)) ?? 1);
}

if (!env.GROQ_API_KEY) console.warn("Warning: GROQ_API_KEY is not set, so extraction and 'Ask the visit log' will fail.");
if (!env.SARVAM_API_KEY) console.warn("Warning: SARVAM_API_KEY is not set, so voice recording will fail (typing still works).");

const viteBin = path.join(webDir, "node_modules", "vite", "bin", "vite.js");
need(viteBin, "Run `pnpm install` first.");

const apiEnv = { ...env, PORT: API_PORT, NODE_ENV: "development" };
const webEnv = { ...env, PORT: WEB_PORT, BASE_PATH: env.BASE_PATH || "/", API_PORT };

let apiProc = null;
let building = false;
let rebuildQueued = false;
let quitting = false;

async function buildAndStartApi() {
  if (building) { rebuildQueued = true; return; }
  building = true;
  if (apiProc) { const old = apiProc; apiProc = null; old.kill(); await done(old); }
  const code = await done(run(["./build.mjs"], { cwd: apiDir, env: apiEnv, log: apiLog }));
  building = false;
  if (quitting) return;
  if (code !== 0) {
    apiLog("Build failed. Fix the error above; it will rebuild when you save.");
  } else {
    apiProc = run(["--enable-source-maps", "./dist/index.mjs"], { cwd: apiDir, env: apiEnv, log: apiLog });
    apiProc.on("close", (c) => { if (!quitting && apiProc) apiLog(`API exited with code ${c}`); });
  }
  if (rebuildQueued) { rebuildQueued = false; void buildAndStartApi(); }
}

let timer;
const watchDirs = [
  path.join(apiDir, "src"),
  path.join(root, "lib", "db", "src"),
  path.join(root, "lib", "api-zod", "src"),
];
for (const dir of watchDirs) {
  try {
    watch(dir, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => { apiLog("Change detected, rebuilding…"); void buildAndStartApi(); }, 400); });
  } catch { /* recursive watch unsupported: restart manually */ }
}

const web = run([viteBin, "--config", "vite.config.ts", "--host", "0.0.0.0"], { cwd: webDir, env: webEnv, log: webLog });
await buildAndStartApi();
console.log(`\nApp:  http://localhost:${WEB_PORT}\nAPI:  http://localhost:${API_PORT}/api/healthz\nPress Ctrl+C to stop.\n`);

const quit = () => { quitting = true; web.kill(); apiProc?.kill(); process.exit(0); };
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
web.on("close", (c) => { if (!quitting) { console.error(`Frontend exited (${c}).`); quit(); } });
