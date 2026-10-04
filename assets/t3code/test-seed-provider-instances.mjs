import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
const seedScript = join(root, "assets/t3code/seed-provider-instances.mjs");
const settingsSeed = join(root, "assets/t3code/settings-seed.json");
const temporaryRoot = mkdtempSync(join(tmpdir(), "t3code-seed-test-"));
const home = join(temporaryRoot, "home");
const userData = join(home, ".t3", "userdata");
const secretDirectory = join(userData, "secrets");
const secretBinary = join(temporaryRoot, "secret");
const projectSecretConfig = join(temporaryRoot, ".secret.json");
const globalSecretConfig = join(temporaryRoot, "global-secret.json");
const secretPath = join(
	secretDirectory,
	`provider-env-${Buffer.from("opencode-go", "utf8").toString("base64url")}-${Buffer.from("OPENCODE_API_KEY", "utf8").toString("base64url")}.bin`,
);

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

try {
	mkdirSync(home, { recursive: true });
	writeFileSync(projectSecretConfig, "{}\n");
	writeFileSync(globalSecretConfig, "{}\n");
	writeFileSync(secretBinary, "#!/bin/sh\nprintf '%s' 'test-credential'\n");
	chmodSync(secretBinary, 0o700);
	const environment = {
		...process.env,
		HOME: home,
		BW_SESSION: "test-session",
		T3CODE_SETTINGS_SEED_PATH: settingsSeed,
		SECRET_BIN: secretBinary,
		PROJECT_SECRET_CONFIG: projectSecretConfig,
		GLOBAL_SECRET_CONFIG: globalSecretConfig,
	};
	const initial = spawnSync(process.execPath, [seedScript], { env: environment, encoding: "utf8" });
	assert(initial.status === 0, `initial seed failed: ${initial.stderr}`);
	assert(readFileSync(secretPath, "utf8") === "test-credential", "provider credential was not written");

	chmodSync(secretPath, 0o644);
	const repeat = spawnSync(process.execPath, [seedScript], { env: environment, encoding: "utf8" });
	assert(repeat.status === 0, `repeat seed failed: ${repeat.stderr}`);
	assert((statSync(secretPath).mode & 0o777) === 0o600, "existing credential mode was not repaired");

	const settingsPath = join(userData, "settings.json");
	const markerPath = join(temporaryRoot, "secret-started");
	writeFileSync(settingsPath, '{"userValue":"before"}\n');
	writeFileSync(
		secretBinary,
		"#!/bin/sh\nif [ ! -e \"$SEED_TEST_MARKER\" ]; then : > \"$SEED_TEST_MARKER\"; sleep 1; fi\nprintf '%s' 'test-credential'\n",
	);
	chmodSync(secretBinary, 0o700);
	const raceEnvironment = { ...environment, SEED_TEST_MARKER: markerPath };
	const child = spawn(process.execPath, [seedScript], {
		cwd: root,
		env: raceEnvironment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk) => {
		stderr += chunk;
	});
	for (let attempt = 0; attempt < 200 && !existsSync(markerPath); attempt += 1) await delay(10);
	assert(existsSync(markerPath), "secret lookup did not start");
	writeFileSync(settingsPath, '{"userValue":"concurrent"}\n');
	const exitCode = await new Promise((resolveExit) => child.once("close", resolveExit));
	assert(exitCode !== 0, "seed overwrote settings changed during secret lookup");
	assert(stderr.includes("settings changed during seeding"), "concurrent settings change was not reported");
	assert(readFileSync(settingsPath, "utf8").includes("concurrent"), "concurrent settings update was lost");
	process.stdout.write("T3 seeder tests: file permissions and concurrent settings preservation passed\n");
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}
