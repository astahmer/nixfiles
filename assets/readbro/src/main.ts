#!/usr/bin/env -S node --no-warnings=ExperimentalWarning --experimental-transform-types --experimental-strip-types
import { runFastCommand } from "./fast-stats.ts";

const argv = process.argv;
const isMcp = argv.length <= 2 || (argv.length === 3 && argv[2] === "mcp");

if (!isMcp && runFastCommand(argv)) {
  // Fast path: gain, stats, clear without loading Effect.
} else {
  void import("./main-effect.ts");
}
