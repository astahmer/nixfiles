import { resolve } from "node:path";
import { IrCacheStore } from "./cache.ts";
import { printFastHelp, wantsHelp } from "./fast-help.ts";
import {
  formatClearResult,
  formatGain,
  formatSessionsList,
  formatStats,
  formatUsageList,
} from "./format.ts";
import {
  listQueryFromInput,
  parseClearFlags,
  parseDoctorFlags,
  parseFastCommand,
  parseLsFlags,
  parseSessionsFlags,
  parseStatsFlags,
  sessionsQueryFromInput,
  statsRequestFromInput,
} from "./stats-cli.ts";
import { doctorExitCode, formatDoctor, runDoctor } from "./doctor.ts";

export const runFastCommand = (argv: ReadonlyArray<string>): boolean => {
  const parsed = parseFastCommand(argv);
  if (!parsed) {
    return false;
  }

  if (wantsHelp(parsed.rest)) {
    printFastHelp(parsed.command);
    return true;
  }

  const cache = new IrCacheStore();
  cache.logUsage(parsed.command, parsed.rest.join(" ") || undefined);

  if (parsed.command === "doctor") {
    const input = parseDoctorFlags(parsed.rest);
    const report = runDoctor({ anchorPath: input.path });
    console.log(formatDoctor(report, input.json));
    if (!report.ok) {
      process.exitCode = doctorExitCode(report);
    }
    return true;
  }

  if (parsed.command === "clear") {
    const options = parseClearFlags(parsed.rest);
    const result = cache.clear(options);
    console.log(formatClearResult(result, options.path ? resolve(options.path) : undefined));
    return true;
  }

  if (parsed.command === "ls") {
    const input = parseLsFlags(parsed.rest);
    const events = cache.listUsage(listQueryFromInput(input));
    console.log(formatUsageList(events, { json: input.json }));
    return true;
  }

  if (parsed.command === "sessions") {
    const input = parseSessionsFlags(parsed.rest);
    const sessions = cache.listSessions(sessionsQueryFromInput(input));
    console.log(formatSessionsList(sessions, { json: input.json }));
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
