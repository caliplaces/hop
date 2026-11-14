import { DatabaseSync } from "node:sqlite";

type SqliteValue = null | number | bigint | string | Uint8Array;

const migrations = import.meta.glob<string>("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * An in-memory D1Database for tests: Node's SQLite with every migration in
 * apps/api/migrations applied, behind just enough of D1's API for
 * drizzle-orm/d1 (prepare, bind, all, raw, run, first, batch).
 */
export function createTestD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  for (const path of Object.keys(migrations).sort()) {
    for (const statement of (migrations[path] ?? "").split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }

  const statement = (query: string, params: SqliteValue[] = []) => ({
    bind: (...next: SqliteValue[]) => statement(query, next),
    all: async () => ({ success: true, meta: {}, results: sqlite.prepare(query).all(...params) }),
    raw: async () => {
      const prepared = sqlite.prepare(query);
      prepared.setReturnArrays(true);
      return prepared.all(...params);
    },
    run: async () => {
      const result = sqlite.prepare(query).run(...params);
      return {
        success: true,
        results: [],
        meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
      };
    },
    first: async (column?: string) => {
      const row = sqlite.prepare(query).get(...params);
      return column ? (row?.[column] ?? null) : (row ?? null);
    },
  });

  const d1 = {
    prepare: (query: string) => statement(query),
    batch: async (statements: ReturnType<typeof statement>[]) => {
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
    },
  };
  return d1 as unknown as D1Database;
}
