/**
 * Token usage dashboard
 *
 * /usage   Show input/output/cache tokens and cost aggregated from local
 *          session logs by calendar period (today / this week / this month /
 *          all time). Read-only; does not touch session state.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface UsageTotals {
	requests: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	costTotal: number;
}

const emptyTotals = (): UsageTotals => ({
	requests: 0,
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	costTotal: 0,
});

const sessionsDir = (): string => {
	const override = process.env.PI_CODING_AGENT_SESSION_DIR;
	if (override) return override;
	try {
		const settings = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf8")) as {
			sessionDir?: string;
		};
		if (typeof settings.sessionDir === "string") return settings.sessionDir;
	} catch {
		// fall through to default
	}
	return join(homedir(), ".pi", "agent", "sessions");
};

const collectSessionFiles = (dir: string): string[] => {
	const files: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir, { withFileTypes: true }).map((e) => e.name);
	} catch {
		return files;
	}
	for (const name of entries) {
		if (!name.endsWith(".jsonl") && !name.includes("--")) continue;
		const full = join(dir, name);
		if (name.endsWith(".jsonl")) files.push(full);
		else files.push(...collectSessionFiles(full));
	}
	return files;
};

interface AssistantUsageRow {
	timestampMs: number;
	usage: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
	};
}

const extractRows = (file: string): AssistantUsageRow[] => {
	const rows: AssistantUsageRow[] = [];
	let content: string;
	try {
		content = readFileSync(file, "utf8");
	} catch {
		return rows;
	}
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let entry: {
			type?: string;
			timestamp?: string;
			message?: { role?: string; timestamp?: number; usage?: AssistantUsageRow["usage"] };
		};
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type !== "message" || entry.message?.role !== "assistant" || !entry.message.usage) continue;
		const timestampMs =
			typeof entry.message.timestamp === "number"
				? entry.message.timestamp
				: entry.timestamp
					? Date.parse(entry.timestamp)
					: NaN;
		if (Number.isNaN(timestampMs)) continue;
		rows.push({ timestampMs, usage: entry.message.usage });
	}
	return rows;
};

const startOfLocalDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date): Date => {
	const day = startOfLocalDay(date);
	const weekday = (day.getDay() + 6) % 7;
	day.setDate(day.getDate() - weekday);
	return day;
};

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

const fmtTokens = (n: number): string => n.toLocaleString("en-US");

const fmtCost = (n: number): string => `$${n.toFixed(2)}`;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("usage", {
		description: "Token usage by day/week/month from local session logs",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const now = new Date();
			const buckets = {
				Today: startOfLocalDay(now).getTime(),
				"This week": startOfWeek(now).getTime(),
				"This month": startOfMonth(now).getTime(),
				"All time": 0,
			};
			const totals: Record<keyof typeof buckets, UsageTotals> = {
				Today: emptyTotals(),
				"This week": emptyTotals(),
				"This month": emptyTotals(),
				"All time": emptyTotals(),
			};

			const files = collectSessionFiles(sessionsDir());
			for (const file of files) {
				for (const row of extractRows(file)) {
					const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost } = row.usage;
					for (const [period, since] of Object.entries(buckets) as [keyof typeof buckets, number][]) {
						if (row.timestampMs < since) continue;
						const t = totals[period];
						t.requests += 1;
						t.input += input;
						t.output += output;
						t.cacheRead += cacheRead;
						t.cacheWrite += cacheWrite;
						t.costTotal += cost?.total ?? 0;
					}
				}
			}

			const header = "Period      Requests  Input       Output     Cache read  Cache write  Cost";
			const lines = [header, "".padEnd(header.length, "─")];
			for (const period of ["Today", "This week", "This month", "All time"] as const) {
				const t = totals[period];
				lines.push(
					period.padEnd(12) +
						String(t.requests).padStart(8) +
						fmtTokens(t.input).padStart(12) +
						fmtTokens(t.output).padStart(11) +
						fmtTokens(t.cacheRead).padStart(12) +
						fmtTokens(t.cacheWrite).padStart(13) +
						fmtCost(t.costTotal).padStart(7),
				);
			}
			lines.push("");
			lines.push(`scanned ${files.length} session file(s) under ${sessionsDir()}`);

			await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Token usage")), 1, 0));
				container.addChild(new Text(theme.fg("normal", lines.join("\n")), 0, 1));
				container.addChild(new Text(theme.fg("dim", "any key to close"), 1, 0));
				container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
				return {
					render: (width) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: () => done(null),
				};
			});
		},
	});
}
