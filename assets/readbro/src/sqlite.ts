import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

declare const Bun: { version: string } | undefined;

export type SQLInputValue = string | number | bigint | Uint8Array | null;

export interface SqlStatement {
  run(...params: ReadonlyArray<SQLInputValue>): unknown;
  get(...params: ReadonlyArray<SQLInputValue>): unknown;
  all(...params: ReadonlyArray<SQLInputValue>): ReadonlyArray<unknown>;
}

export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

export const openDatabase = (path: string): SqlDatabase => {
  if (typeof Bun !== "undefined") {
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    return new Database(path, { create: true }) as SqlDatabase;
  }
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  return new DatabaseSync(path) as SqlDatabase;
};
