import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

// The desktop/portable edition uses PGlite: PostgreSQL compiled to WebAssembly
// and stored inside this directory.  It needs no installed database service,
// network listener, username, password, or DATABASE_URL.
//
// pgvector is bundled as an in-process extension (@electric-sql/pglite-pgvector),
// so semantic (HNSW) retrieval works fully offline — no external PostgreSQL
// server is required for vector search any more.
const databaseDirectory = path.resolve(
  process.cwd(),
  process.env.PORTABLE_DATABASE_DIR ?? "./storage/database",
);

const globalForDb = globalThis as typeof globalThis & {
  __arenaPortableDatabase?: PGlite;
};

// PGlite creates its own final directory but not a missing parent directory.
fs.mkdirSync(path.dirname(databaseDirectory), { recursive: true });
export const client =
  globalForDb.__arenaPortableDatabase ??
  new PGlite(databaseDirectory, {
    extensions: { vector },
  });
globalForDb.__arenaPortableDatabase = client;

export const db = drizzle(client);
export const isPortableDatabase = true;

/**
 * True once `CREATE EXTENSION vector` has succeeded for this database.
 * Retrieval code uses it to decide whether the HNSW/vector path is available;
 * when it is not (e.g. an extension load failure), search degrades to
 * keyword-only retrieval instead of crashing.
 */
export function isVectorSearchAvailable(): boolean {
  return globalForDb.__arenaVectorAvailable === true;
}

export function markVectorSearchAvailable(available: boolean): void {
  globalForDb.__arenaVectorAvailable = available;
}

declare global {
  var __arenaVectorAvailable: boolean | undefined;
}
