#!/usr/bin/env -S node --no-warnings=ExperimentalWarning --experimental-transform-types --experimental-strip-types
import { layer as NodeContextLayer } from "@effect/platform-node/NodeContext";
import { runMain } from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { run as runCli } from "./cli.ts";
import { McpLayer } from "./mcp.ts";
import { ReadbroLive } from "./readbro.ts";

const isMcp =
  process.argv.length <= 2 || (process.argv.length === 3 && process.argv[2] === "mcp");

const program = isMcp
  ? Layer.launch(McpLayer)
  : runCli(process.argv).pipe(Effect.provide(ReadbroLive));

runMain(program.pipe(Effect.provide(NodeContextLayer)));
