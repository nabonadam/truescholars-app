import { type Column, getTableName, sql } from "drizzle-orm";

/**
 * A column written with its table name ("lit_reviews"."id"). Use it for the outer row inside a
 * correlated subquery: drizzle writes plain "id" in single-table selects, which Postgres would
 * otherwise bind to the subquery's own table.
 */
export const col = (c: Column) => sql.raw(`"${getTableName(c.table)}"."${c.name}"`);
