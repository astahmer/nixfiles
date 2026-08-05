// Minimal ambient types for the optional bun runtime path in sqlite.ts.
// readbro typechecks against node types only, so bun's own global
// declarations are intentionally not pulled in.
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { create?: boolean });
    exec(sql: string): void;
    prepare(sql: string): unknown;
    close(): void;
  }
}
