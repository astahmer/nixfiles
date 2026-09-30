import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const hasControlCharacters = (value: string) =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

export const locationSchema = z.object({
  hostId: z.string().min(1).max(256),
  cwd: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (path) => path.startsWith("/") && !hasControlCharacters(path),
      "must be an absolute path without control characters",
    ),
});

export const aliasSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\p{L}_][\p{L}\p{N}_-]*$/u, "must be a configured alias name");

export const secretEntrySchema = z.object({
  alias: z.string().min(1).max(256),
  scope: z.string().max(64),
  env: z.string().max(128),
  item: z.string().max(512),
  field: z.string().max(128),
  envKey: z.string().max(256),
});

export const hostContract = defineRpcContract({
  list: {
    input: z.object({
      cwd: locationSchema.shape.cwd.optional(),
      scope: z.enum(["all", "project", "global", "local"]),
    }),
    output: z.object({ entries: z.array(secretEntrySchema).max(2000) }),
  },
  get: {
    input: z.object({
      cwd: locationSchema.shape.cwd,
      alias: aliasSchema,
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
    }),
    output: z.object({ value: z.string().max(1_000_000) }),
  },
  copy: {
    input: z.object({
      cwd: locationSchema.shape.cwd,
      alias: aliasSchema,
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  set: {
    input: z.object({
      cwd: locationSchema.shape.cwd,
      alias: aliasSchema,
      value: z.string().min(1).max(1_000_000),
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
      itemType: z.enum(["login", "secure-note"]).optional(),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  rename: {
    input: z.object({
      cwd: locationSchema.shape.cwd.optional(),
      alias: aliasSchema,
      newAlias: aliasSchema,
      scope: z.enum(["project", "global", "local"]),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  unset: {
    input: z.object({
      cwd: locationSchema.shape.cwd.optional(),
      alias: aliasSchema,
      scope: z.enum(["project", "global", "local"]),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
});

export const rpcContract = defineRpcContract({
  list: {
    input: locationSchema.extend({ scope: z.enum(["all", "project", "global", "local"]) }),
    output: z.object({ entries: z.array(secretEntrySchema).max(2000) }),
  },
  get: {
    input: locationSchema.extend({
      alias: aliasSchema,
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
    }),
    output: z.object({ value: z.string().max(1_000_000) }),
  },
  copy: {
    input: locationSchema.extend({
      alias: aliasSchema,
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  set: {
    input: locationSchema.extend({
      alias: aliasSchema,
      value: z.string().min(1).max(1_000_000),
      environment: z.string().min(1).max(128),
      scope: z.enum(["project", "global", "local"]).optional(),
      itemType: z.enum(["login", "secure-note"]).optional(),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  rename: {
    input: locationSchema.extend({
      alias: aliasSchema,
      newAlias: aliasSchema,
      scope: z.enum(["project", "global", "local"]),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
  unset: {
    input: locationSchema.extend({
      alias: aliasSchema,
      scope: z.enum(["project", "global", "local"]),
    }),
    output: z.object({ message: z.string().max(512) }),
  },
});
