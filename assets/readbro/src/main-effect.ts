import { layer as NodeContextLayer } from "@effect/platform-node/NodeContext";
import { runMain } from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { run as runCli } from "./cli.ts";
import { ReadbroLive } from "./readbro.ts";

const argv = process.argv;
const isMcp = argv.length <= 2 || (argv.length === 3 && argv[2] === "mcp");

const launchMcp = Effect.gen(function* () {
  const { McpLayer } = yield* Effect.promise(() => import("./mcp.ts"));
  return yield* Layer.launch(McpLayer);
});

const program = isMcp
  ? launchMcp
  : runCli(argv).pipe(Effect.provide(ReadbroLive));

runMain(program.pipe(Effect.provide(NodeContextLayer)));
