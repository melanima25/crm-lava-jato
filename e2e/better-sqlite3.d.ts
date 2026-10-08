// Tipos mínimos do better-sqlite3 (sem @types) para o helper de banco dos e2e.
declare module "better-sqlite3" {
  interface Statement {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
  export default class Database {
    constructor(path: string, options?: { readonly?: boolean; timeout?: number });
    prepare(sql: string): Statement;
    transaction<F extends () => void>(fn: F): F;
    pragma(source: string): unknown;
    close(): void;
  }
}
