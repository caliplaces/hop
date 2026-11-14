/**
 * Types for test-only helpers. The API compiles against Workers types, not
 * Node's, so the two Node and Vite features the tests use are declared here.
 */

// Node's built-in SQLite, which backs the D1 stand-in in ./d1.ts.
declare module "node:sqlite" {
  type SqliteValue = null | number | bigint | string | Uint8Array;
  export interface StatementSync {
    all(...params: SqliteValue[]): Record<string, SqliteValue>[];
    get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined;
    run(...params: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    setReturnArrays(enabled: boolean): void;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}

// Vite's import.meta.glob, used to load every migration file.
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { query: "?raw"; import: "default"; eager: true },
  ): Record<string, T>;
}
