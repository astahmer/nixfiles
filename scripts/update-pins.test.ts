import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scriptPath = resolve(import.meta.dir, "update-pins.ts");
const repoRoot = resolve(import.meta.dir, "..");

test("unknown --only entries fail before running an update", () => {
	const result = spawnSync("bun", [scriptPath, "--only", "__unknown_update_entry__", "--dry-run"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, UPDATE_PINS_REPO_ROOT: repoRoot },
	});

	expect(result.status).toBe(2);
	expect(result.stderr).toContain("Unknown update entry in --only: __unknown_update_entry__");
	expect(result.stdout).toBe("");
});

test("unknown validation sets fail before running an update", () => {
	const result = spawnSync(
		"bun",
		[scriptPath, "--validate", "__unknown_validation__", "--dry-run"],
		{ cwd: repoRoot, encoding: "utf8", env: { ...process.env, UPDATE_PINS_REPO_ROOT: repoRoot } },
	);

	expect(result.status).toBe(2);
	expect(result.stderr).toContain("Unknown validation set: __unknown_validation__");
	expect(result.stdout).toBe("");
});

test("registered flake inputs can be selected without changing the lockfile", () => {
	const result = spawnSync("bun", [scriptPath, "--only", "devenv", "--dry-run"], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, UPDATE_PINS_REPO_ROOT: repoRoot },
	});

	expect(result.status).toBe(0);
	expect(result.stdout).toContain("nix flake lock --update-input devenv");
	expect(result.stdout).toContain("dry run");
});
