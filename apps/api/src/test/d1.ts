import { DatabaseSync } from "node:sqlite";

export type SqliteValue = null | number | bigint | string | Uint8Array;

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** D1 binds at most this many values per statement. */
const MAX_BOUND_VALUES = 100;

/**
 * An in-memory D1Database for tests: Node's SQLite with every migration in
 * apps/api/migrations applied, behind just enough of D1's API for
 * drizzle-orm/d1 (prepare, bind, all, raw, run, first, batch).
 * `onQuery` sees each statement as it runs, such as to check its query plan.
 */
export function createTestD1(
  options: { onQuery?: (query: string, params: SqliteValue[]) => void } = {},
): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const path of Object.keys(migrations).sort()) {
    for (const statement of (migrations[path] ?? "").split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }

  const statement = (query: string, params: SqliteValue[] = []) => ({
    bind: (...next: SqliteValue[]) => {
      // As on D1, which refuses a statement binding more than 100 values.
      if (next.length > MAX_BOUND_VALUES) {
        throw new Error(`D1_ERROR: too many SQL variables (${next.length} > ${MAX_BOUND_VALUES})`);
      }
      return statement(query, next);
    },
    all: async () => {
      options.onQuery?.(query, params);
      return { success: true, meta: {}, results: sqlite.prepare(query).all(...params) };
    },
    raw: async () => {
      options.onQuery?.(query, params);
      const prepared = sqlite.prepare(query);
      prepared.setReturnArrays(true);
      return prepared.all(...params);
    },
    run: async () => {
      options.onQuery?.(query, params);
      const result = sqlite.prepare(query).run(...params);
      return {
        success: true,
        results: [],
        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
      };
    },
    first: async (column?: string) => {
      options.onQuery?.(query, params);
      const row = sqlite.prepare(query).get(...params);
      return column ? (row?.[column] ?? null) : (row ?? null);
    },
  });

  // Batches run one at a time, as on D1: each is its own transaction, and
  // SQLite can't nest them when callers batch concurrently.
  let queue: Promise<unknown> = Promise.resolve();
  const runBatch = async (statements: ReturnType<typeof statement>[]) => {
    sqlite.exec("begin");
    try {
      const results = [];
      for (const s of statements) results.push(await s.all());
      sqlite.exec("commit");
      return results;
    } catch (error) {
      sqlite.exec("rollback");
      throw error;
    }
  };
  const d1 = {
    prepare: (query: string) => statement(query),
    batch: (statements: ReturnType<typeof statement>[]) => {
      const run = queue.then(() => runBatch(statements));
      queue = run.catch(() => {});
      return run;
    },
  };
  return d1 as unknown as D1Database;
}
