// Next.js instrumentation hook: runs once when the server process starts.
// We use it to automatically apply pending Drizzle migrations so the
// database schema always exists before any request (including the very
// first visit to the initial setup wizard) is handled.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDatabaseMigrated } = await import("@/db/migrate");
    try {
      await ensureDatabaseMigrated();
    } catch (error) {
      console.error("[instrumentation] database migration failed", error);
    }
  }
}
