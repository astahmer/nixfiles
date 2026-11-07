import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MIN_FREE_GIB = 20;
const DEFAULT_MIN_NIX_VERSION = "2.34.9";
const KIB = 1024;
const GIB = KIB ** 2;

export type CheckStatus = "ok" | "warning" | "error";

export type CheckResult = {
	name: string;
	status: CheckStatus;
	detail: string;
	recovery?: string;
};

export type DiskUsage = {
	freeKb: number;
	totalKb: number;
	usedPercent: string;
};

export type BundleEntry = {
	bundleId: string;
	path: string;
	sizeKb: number;
};

export type DuplicateBundleGroup = {
	bundleId: string;
	totalKb: number;
	bundles: BundleEntry[];
};

export type BundleSource = "shadow" | "legacy Home Manager Apps" | "nix" | "system";

type DirectoryEntry = {
	name: string;
	isDirectory: () => boolean;
};

const run = ({ command, args }: { command: string; args: string[] }) =>
	spawnSync(command, args, { encoding: "utf8" });

const listDirectory = (path: string): DirectoryEntry[] => {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
};

const safeRealpath = (path: string) => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

const formatGib = (kib: number) => (kib / GIB).toFixed(2);

const formatCode = (value: string) => `\`${value}\``;

export const evaluateDisk = ({
	freeKb,
	totalKb,
	usedPercent,
	minFreeGib = DEFAULT_MIN_FREE_GIB,
}: DiskUsage & { minFreeGib?: number }): CheckResult => {
	const minimumKb = minFreeGib * GIB;
	if (freeKb >= minimumKb) {
		return {
			name: "disk free",
			status: "ok",
			detail: `${formatGib(freeKb)} GiB free on / (threshold ${minFreeGib} GiB)`,
		};
	}

	return {
		name: "disk free",
		status: "warning",
		detail: `${formatGib(freeKb)} GiB free on /, below ${minFreeGib} GiB (df: ${freeKb} KiB available of ${totalKb} KiB, ${usedPercent} used)`,
		recovery:
			"free space with `nixfiles-reclaim` (weekly nix-collect-garbage) or `nix-collect-garbage --delete-older-than 14d`",
	};
};

export const parseVersion = (value: string) => {
	const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
};

export const isVersionBelow = ({
	current,
	minimum,
}: {
	current: string;
	minimum: string;
}) => {
	const currentParts = parseVersion(current);
	const minimumParts = parseVersion(minimum);
	if (!currentParts || !minimumParts) return null;

	for (let index = 0; index < 3; index += 1) {
		if (currentParts[index] !== minimumParts[index]) {
			return currentParts[index] < minimumParts[index];
		}
	}
	return false;
};

export const evaluateNixVersion = ({
	output,
	minimum = DEFAULT_MIN_NIX_VERSION,
}: {
	output: string;
	minimum?: string;
}): CheckResult => {
	const version = output.trim().replace(/^nix \(Nix\)\s*/, "");
	const below = isVersionBelow({ current: version, minimum });
	if (below === null) {
		return {
			name: "nix version",
			status: "warning",
			detail: `could not parse \`nix --version\` output: ${output.trim()}`,
			recovery: `install Nix ${minimum} or newer`,
		};
	}
	if (below) {
		return {
			name: "nix version",
			status: "warning",
			detail: `Nix ${version} is older than ${minimum}`,
			recovery: `upgrade Nix to ${minimum} or newer so relative worktree git extensions evaluate`,
		};
	}

	return {
		name: "nix version",
		status: "ok",
		detail: `Nix ${version} is at least ${minimum}`,
	};
};

export const findAppHomeLeftovers = ({ root }: { root: string }) => {
	const leftovers: string[] = [];

	const walk = (directory: string) => {
		for (const entry of listDirectory(directory)) {
			const path = join(directory, entry.name);
			if (entry.name.includes(".app-as-home")) {
				leftovers.push(path);
				continue;
			}
			if (!entry.isDirectory() || entry.name.endsWith(".app")) continue;
			walk(path);
		}
	};

	walk(root);
	return leftovers;
};

export const findSqliteSidecarDirectories = ({
	roots,
}: {
	roots: string[];
}) => {
	const sidecars: { database: string; sidecar: string }[] = [];

	const walk = (directory: string) => {
		const entries = listDirectory(directory);
		const names = new Set(entries.map((entry) => entry.name));

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (!entry.name.endsWith("-wal") && !entry.name.endsWith("-shm")) continue;
			const databaseName = entry.name.slice(0, -4);
			if (!names.has(databaseName)) continue;
			sidecars.push({
				database: join(directory, databaseName),
				sidecar: join(directory, entry.name),
			});
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			walk(join(directory, entry.name));
		}
	};

	for (const root of roots) walk(root);
	return sidecars;
};

export const summarizeDuplicateBundles = ({
	bundles,
	applicationsRoot,
}: {
	bundles: BundleEntry[];
	applicationsRoot: string;
}) => {
	const seen = new Set<string>();
	const byId = new Map<string, BundleEntry[]>();

	for (const bundle of bundles) {
		const key = `${bundle.bundleId}\0${bundle.path}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const group = byId.get(bundle.bundleId) ?? [];
		group.push(bundle);
		byId.set(bundle.bundleId, group);
	}

	return [...byId.entries()]
		.filter(
			([, group]) =>
				group.length > 1 &&
				group.some((bundle) => dirname(bundle.path) === applicationsRoot),
		)
		.map(([bundleId, group]) => ({
			bundleId,
			totalKb: group.reduce((sum, bundle) => sum + bundle.sizeKb, 0),
			bundles: [...group].sort((left, right) => right.sizeKb - left.sizeKb),
		}))
		.sort((left, right) => right.totalKb - left.totalKb);
};

const readDiskUsage = (): DiskUsage | null => {
	const result = run({ command: "df", args: ["-Pk", "/"] });
	if (result.status !== 0) return null;

	const line = result.stdout.trim().split("\n")[1];
	if (!line) return null;
	const fields = line.trim().split(/\s+/);
	const totalKb = Number(fields[1]);
	const usedKb = Number(fields[2]);
	const freeKb = Number(fields[3]);
	if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb) || !Number.isFinite(freeKb)) {
		return null;
	}

	return { freeKb, totalKb, usedPercent: fields[4] ?? "unknown" };
};

const readNixVersion = () => {
	const result = run({ command: "nix", args: ["--version"] });
	if (result.status !== 0) return null;
	return result.stdout;
};

const readBundleId = ({ path }: { path: string }) => {
	const result = run({
		command: "plutil",
		args: ["-extract", "CFBundleIdentifier", "raw", "-o", "-", join(path, "Contents", "Info.plist")],
	});
	if (result.status !== 0) return null;
	const bundleId = result.stdout.trim();
	return bundleId || null;
};

const readBundleSizeKb = ({ path }: { path: string }) => {
	const result = run({ command: "du", args: ["-sk", path] });
	if (result.status !== 0) return 0;
	const sizeKb = Number(result.stdout.trim().split(/\s+/)[0]);
	return Number.isFinite(sizeKb) ? sizeKb : 0;
};

export const collectBundles = ({ roots }: { roots: string[] }) => {
	const seen = new Set<string>();
	const bundles: BundleEntry[] = [];

	const walk = ({ directory, depth }: { directory: string; depth: number }) => {
		for (const entry of listDirectory(directory)) {
			const path = join(directory, entry.name);
			if (!entry.isDirectory()) continue;

			if (entry.name.endsWith(".app")) {
				const canonicalPath = safeRealpath(path);
				if (seen.has(canonicalPath)) continue;
				seen.add(canonicalPath);
				const bundleId = readBundleId({ path: canonicalPath });
				if (!bundleId) continue;
				bundles.push({
					bundleId,
					path: canonicalPath,
					sizeKb: readBundleSizeKb({ path: canonicalPath }),
				});
				continue;
			}

			if (depth < 3) walk({ directory: path, depth: depth + 1 });
		}
	};

	for (const root of roots) walk({ directory: root, depth: 0 });
	return bundles;
};

export const classifyBundle = ({
	path,
	applicationsRoot,
}: {
	path: string;
	applicationsRoot: string;
}): BundleSource => {
	const directory = dirname(path);
	if (directory === applicationsRoot) return "shadow";
	if (directory === join(applicationsRoot, "Home Manager Apps")) return "legacy Home Manager Apps";
	if (path.startsWith("/nix/store/")) return "nix";
	return "system";
};

export const formatDuplicateGroup = (group: DuplicateBundleGroup, applicationsRoot: string) => {
	const bundles = group.bundles
		.map(
			(bundle) =>
				`${classifyBundle({ path: bundle.path, applicationsRoot })}: ${bundle.path} (${formatGib(bundle.sizeKb)} GB)`,
		)
		.join(", ");
	return `${group.bundleId}: ${formatGib(group.totalKb)} GB total — ${bundles}`;
};

const collectResults = () => {
	const home = process.env.HOME || homedir();
	const applicationsRoot = safeRealpath(join(home, "Applications"));
	const results: CheckResult[] = [];

	const disk = readDiskUsage();
	results.push(
		disk
			? evaluateDisk(disk)
			: {
					name: "disk free",
					status: "error",
					detail: "could not read free space with `df -Pk /`",
					recovery: "run `df -Pk /` manually and inspect the failure",
				},
	);

	const leftovers = findAppHomeLeftovers({ root: applicationsRoot });
	results.push(
		leftovers.length
			? {
					name: "app-as-home leftovers",
					status: "error",
					detail: leftovers.join(", "),
					recovery: `remove each leftover after confirming it is not a live app: ${formatCode(`rm -rf ${leftovers[0]}`)}`,
				}
			: {
					name: "app-as-home leftovers",
					status: "ok",
					detail: "none under ~/Applications",
				},
	);

	const sidecars = findSqliteSidecarDirectories({
		roots: [
			join(home, ".codex"),
			join(home, ".claude"),
			join(home, ".config", "opencode"),
		],
	});
	results.push(
		sidecars.length
			? {
					name: "sqlite sidecar directories",
					status: "error",
					detail: sidecars
						.map(({ database, sidecar }) => `${sidecar} (beside ${database})`)
						.join(", "),
					recovery: `move the sidecar directory aside and restart the harness that owns the database: ${formatCode(`mv ${sidecars[0].sidecar} ${sidecars[0].sidecar}.bak`)}`,
				}
			: {
					name: "sqlite sidecar directories",
					status: "ok",
					detail: "no -wal/-shm directories beside SQLite databases",
				},
	);

	const bundles = collectBundles({
		roots: [
			"/Applications",
			applicationsRoot,
			join(applicationsRoot, "Home Manager Apps"),
		],
	});
	const duplicates = summarizeDuplicateBundles({ bundles, applicationsRoot });
	results.push(
		duplicates.length
			? {
					name: "duplicate bundle ids",
					status: "warning",
					detail: duplicates.map((group) => formatDuplicateGroup(group, applicationsRoot)).join("\n"),
					recovery:
						"remove the shadow copy under ~/Applications; a legacy Home Manager Apps copy is safe to remove when it duplicates a system or installed app",
				}
			: {
					name: "duplicate bundle ids",
					status: "ok",
					detail: "no shadow copies directly under ~/Applications",
				},
	);

	const nixVersion = readNixVersion();
	results.push(
		nixVersion
			? evaluateNixVersion({ output: nixVersion })
			: {
					name: "nix version",
					status: "error",
					detail: "could not run `nix --version`",
					recovery: "make sure `nix` is on PATH, then run `nix --version` manually",
				},
	);

	return results;
};

const printResults = (results: CheckResult[]) => {
	const labels: Record<CheckStatus, string> = {
		ok: "ok  ",
		warning: "warn",
		error: "fail",
	};

	for (const result of results) {
		const [firstLine, ...rest] = result.detail.split("\n");
		console.log(`${labels[result.status]} ${result.name}: ${firstLine}`);
		for (const line of rest) console.log(`     ${line}`);
		if (result.recovery) console.log(`     fix: ${result.recovery}`);
	}

	const errors = results.filter((result) => result.status === "error").length;
	const warnings = results.filter((result) => result.status === "warning").length;
	console.log(`nixfiles-doctor: ${errors} failures, ${warnings} warnings`);
	return errors;
};

const main = () => {
	const results = collectResults();
	const errors = printResults(results);
	process.exitCode = errors > 0 ? 1 : 0;
};

const invokedPath = process.argv[1] ? safeRealpath(resolve(process.argv[1])) : "";
const modulePath = safeRealpath(fileURLToPath(import.meta.url));
if (invokedPath && invokedPath === modulePath) {
	main();
}
