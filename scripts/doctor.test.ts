import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	classifyBundle,
	evaluateDisk,
	evaluateNixVersion,
	findAppHomeLeftovers,
	findSqliteSidecarDirectories,
	formatDuplicateGroup,
	isVersionBelow,
	summarizeDuplicateBundles,
} from "./doctor.mts";

const withTempDirectory = (run: (directory: string) => void) => {
	const directory = mkdtempSync(join(tmpdir(), "nixfiles-doctor-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

describe("entry point", () => {
	test(
		"runs when invoked through a symlink",
		() => {
			withTempDirectory((directory) => {
				const link = join(directory, "doctor-link.mts");
				symlinkSync(fileURLToPath(new URL("./doctor.mts", import.meta.url)), link);

				const result = spawnSync("node", [link], {
					encoding: "utf8",
					env: { ...process.env, HOME: directory },
				});

				expect(result.status).toBe(0);
				expect(result.stdout).toContain("nixfiles-doctor:");
			});
		},
		30000,
	);
});

describe("disk check", () => {
	test("warns below the threshold and keeps the exact df numbers", () => {
		const result = evaluateDisk({
			freeKb: 10 * 1024 * 1024,
			totalKb: 100 * 1024 * 1024,
			usedPercent: "90%",
			minFreeGib: 20,
		});

		expect(result.status).toBe("warning");
		expect(result.detail).toContain("10.00 GiB free on /");
		expect(result.detail).toContain("10485760 KiB available");
		expect(result.detail).toContain("90% used");
		expect(result.recovery).toContain("nixfiles-reclaim");
	});

	test("passes at the threshold", () => {
		const result = evaluateDisk({
			freeKb: 20 * 1024 * 1024,
			totalKb: 100 * 1024 * 1024,
			usedPercent: "80%",
		});

		expect(result.status).toBe("ok");
	});
});

describe("nix version check", () => {
	test("compares versions numerically", () => {
		expect(isVersionBelow({ current: "2.34.6", minimum: "2.34.9" })).toBe(true);
		expect(isVersionBelow({ current: "2.34.9", minimum: "2.34.9" })).toBe(false);
		expect(isVersionBelow({ current: "2.35.0", minimum: "2.34.9" })).toBe(false);
	});

	test("warns for an old Nix and accepts a current one", () => {
		const old = evaluateNixVersion({ output: "nix (Nix) 2.34.6\n" });
		const current = evaluateNixVersion({ output: "nix (Nix) 2.34.9\n" });

		expect(old.status).toBe("warning");
		expect(old.detail).toContain("2.34.6");
		expect(current.status).toBe("ok");
	});

	test("warns when the version cannot be parsed", () => {
		const result = evaluateNixVersion({ output: "not a version" });

		expect(result.status).toBe("warning");
		expect(result.recovery).toContain("2.34.9");
	});
});

describe("app-as-home leftovers", () => {
	test("finds artifacts without descending into app bundles", () => {
		withTempDirectory((directory) => {
			mkdirSync(join(directory, "Foo.app", "Contents"), { recursive: true });
			writeFileSync(join(directory, "Foo.app-as-home.file"), "");
			writeFileSync(join(directory, "Foo.app", "Contents", "Bar.app-as-home.file"), "");

			const leftovers = findAppHomeLeftovers({ root: directory });

			expect(leftovers).toEqual([join(directory, "Foo.app-as-home.file")]);
		});
	});
});

describe("sqlite sidecar directories", () => {
	test("reports only directories beside an existing database", () => {
		withTempDirectory((directory) => {
			writeFileSync(join(directory, "codex.db"), "");
			mkdirSync(join(directory, "codex.db-wal"));
			writeFileSync(join(directory, "other.db-wal"), "");

			const sidecars = findSqliteSidecarDirectories({ roots: [directory] });

			expect(sidecars).toEqual([
				{
					database: join(directory, "codex.db"),
					sidecar: join(directory, "codex.db-wal"),
				},
			]);
		});
	});
});

describe("duplicate bundle groups", () => {
	const applicationsRoot = "/Users/me/Applications";

	test("groups distinct app paths and sums their sizes", () => {
		const duplicates = summarizeDuplicateBundles({
			applicationsRoot,
			bundles: [
				{ bundleId: "com.example.app", path: "/Applications/App.app", sizeKb: 2 * 1024 * 1024 },
				{
					bundleId: "com.example.app",
					path: `${applicationsRoot}/App.app`,
					sizeKb: 1 * 1024 * 1024,
				},
				{ bundleId: "com.example.app", path: "/Applications/App.app", sizeKb: 2 * 1024 * 1024 },
				{ bundleId: "com.example.single", path: "/Applications/Single.app", sizeKb: 1024 },
			],
		});

		expect(duplicates).toHaveLength(1);
		expect(duplicates[0].bundleId).toBe("com.example.app");
		expect(duplicates[0].bundles).toHaveLength(2);
		expect(duplicates[0].totalKb).toBe(3 * 1024 * 1024);
	});

	test("ignores system and Home Manager Apps pairs", () => {
		const duplicates = summarizeDuplicateBundles({
			applicationsRoot,
			bundles: [
				{ bundleId: "com.raycast.macos", path: "/Applications/Raycast.app", sizeKb: 100 },
				{
					bundleId: "com.raycast.macos",
					path: `${applicationsRoot}/Home Manager Apps/Raycast.app`,
					sizeKb: 50,
				},
			],
		});

		expect(duplicates).toEqual([]);
	});

	test("labels shadow and legacy copies on one summary line", () => {
		const line = formatDuplicateGroup(
			{
				bundleId: "com.example.app",
				totalKb: 3 * 1024 * 1024,
				bundles: [
					{
						bundleId: "com.example.app",
						path: `${applicationsRoot}/App.app`,
						sizeKb: 2 * 1024 * 1024,
					},
					{
						bundleId: "com.example.app",
						path: `${applicationsRoot}/Home Manager Apps/App.app`,
						sizeKb: 1 * 1024 * 1024,
					},
				],
			},
			applicationsRoot,
		);

		expect(line).toContain("com.example.app: 3.00 GB total");
		expect(line).toContain(`shadow: ${applicationsRoot}/App.app (2.00 GB)`);
		expect(line).toContain(
			`legacy Home Manager Apps: ${applicationsRoot}/Home Manager Apps/App.app (1.00 GB)`,
		);
		expect(classifyBundle({ path: "/Applications/App.app", applicationsRoot })).toBe("system");
		expect(classifyBundle({ path: "/nix/store/x/App.app", applicationsRoot })).toBe("nix");
	});
});
