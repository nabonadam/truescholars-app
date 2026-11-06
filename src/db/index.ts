import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/** Any Drizzle Postgres database using our schema (node-postgres in the app, PGlite in tests). */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Lazily creates one connection pool per server process. */
export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    // Timestamps are stored without a time zone, so every connection works in UTC: times written by the
    // app (new Date()) and by the database (now()) then always agree, whatever the server's own zone.
    const pool = new Pool({ connectionString: url, max: 10, options: "-c timezone=UTC" });
    cached = drizzle(pool, { schema });
  }
  return cached;
}

export { schema };
