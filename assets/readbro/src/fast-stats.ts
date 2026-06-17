import { resolve } from "node:path";
import { IrCacheStore } from "./cache.ts";
import { formatGain, formatStats } from "./format.ts";
import {
  parseClearFlags,
  parseFastCommand,
  parseStatsFlags,
  statsRequestFromInput,
} from "./stats-cli.ts";

export const runFastCommand = (argv: ReadonlyArray<string>): boolean => {
  const parsed = parseFastCommand(argv);
  if (!parsed) {
    return false;
  }

  const cache = new IrCacheStore();

  if (parsed.command === "clear") {
    const path = parseClearFlags(parsed.rest);
    cache.clear(path);
    console.log(
      path
        ? `Cache cleared for ${resolve(path)} working copy.`
        : "Cache cleared for all open repo databases.",
    );
    return true;
  }

  const request = statsRequestFromInput(parseStatsFlags(parsed.rest));
  const stats = cache.getStats(request.query);
  console.log(
    parsed.command === "gain"
      ? formatGain(stats, request.format)
      : formatStats(stats, request.format),
  );
  return true;
};
