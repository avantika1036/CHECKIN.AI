   import { createRequire } from "node:module";
   import { existsSync, readFileSync } from "node:fs";

   const env = { ...process.env };
   if (existsSync(".env")) {
     for (const raw of readFileSync(".env", "utf8").split(/\r?\n/)) {
       const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
       if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
     }
   }
   const url = env.DATABASE_URL;
   if (!url) { console.error("DATABASE_URL is empty or .env was not found in this folder."); process.exit(1); }

   try {
     const u = new URL(url);
     console.log(`Host: ${u.hostname}  Port: ${u.port || "(default 5432)"}  User: ${u.username}  DB: ${u.pathname.slice(1)}  sslmode: ${u.searchParams.get("sslmode") ?? "(none)"}`);
   } catch {
     console.error("DATABASE_URL is not a valid URL. Check for special characters in the password, spaces, or leftover placeholders.");
     process.exit(1);
   }

   const require = createRequire(new URL("../lib/db/package.json", import.meta.url));
   const pg = require("pg");
   const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 });
   try {
     await client.connect();
     const r = await client.query("select current_database() as db, version() as v");
     console.log("Connected OK:", r.rows[0].db, "-", r.rows[0].v.split(",")[0]);
     await client.end();
   } catch (e) {
     console.error("Connection FAILED:", e.code || "", e.message);
     process.exit(1);
   }