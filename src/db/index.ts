import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

// The desktop/portable edition uses PGlite: PostgreSQL compiled to WebAssembly
// and stored inside this directory.  It needs no installed database service,
// network listener, username, password, or DATABASE_URL.
const databaseDirectory = path.resolve(
  process.cwd(),
  process.env.PORTABLE_DATABASE_DIR ?? "./storage/database",
);

const globalForDb = globalThis as typeof globalThis & {
  __arenaPortableDatabase?: PGlite;
};

// PGlite creates its own final directory but not a missing parent directory.
fs.mkdirSync(path.dirname(databaseDirectory), { recursive: true });
export const client = globalForDb.__arenaPortableDatabase ?? new PGlite(databaseDirectory);
globalForDb.__arenaPortableDatabase = client;

export const db = drizzle(client);
export const isPortableDatabase = true;
