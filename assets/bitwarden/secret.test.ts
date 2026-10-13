// Fake-bw regression suite for the secret CLI: Swift port by default, TS
// reference implementation with SECRET_IMPL=ts. Self-contained: fake bw/pbcopy/
// open/security binaries and a temp HOME, no real vault or network. Tests share
// one fake vault and run in declaration order, so later tests rely on earlier state.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

setDefaultTimeout(30_000);

const repoRoot = resolve(import.meta.dir, "../..");
const tsScript = join(import.meta.dir, "secret.ts");
const bunBin = process.env.BUN ?? process.execPath;
const impl = process.env.SECRET_IMPL ?? "swift";
const tmp = mkdtempSync(join(tmpdir(), "secret-test-"));
const projectDir = join(tmp, "proj");
const fakeLog = join(tmp, "log.txt");
const fakeClip = join(tmp, "clip.txt");
const fakeOpen = join(tmp, "open.txt");
const fakeKeychain = join(tmp, "keychain.txt");
const globalConfig = join(tmp, ".config/secret/config.json");
const daemonLog = join(tmp, "daemon-log.txt");
const daemonMissing = join(tmp, "daemon-missing.txt");
const isDarwin = process.platform === "darwin";

let secretCommand: string[] = [bunBin, tsScript];

const { BW_SESSION: _inheritedSession, ...inheritedEnv } = process.env;
const sharedEnv: Record<string, string | undefined> = {
  ...inheritedEnv,
  PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
  HOME: tmp,
  FAKE_BUN_BIN: bunBin,
  FAKE_LOG: fakeLog,
  FAKE_CLIP: fakeClip,
  FAKE_OPEN: fakeOpen,
  FAKE_KEYCHAIN: fakeKeychain,
  FAKE_BW_STATUS: '{"status":"unlocked"}',
  SECRET_DAEMON: "0",
};

const lockedStatus = { FAKE_BW_STATUS: '{"status":"locked"}' };

type SecretRun = { exitCode: number; stdout: string; stderr: string };

// stdout/stderr lose trailing newlines like shell `$(...)`; mergeStderr
// interleaves stderr into stdout in write order (shell `2>&1`).
const runSecret = ({
  args,
  cwd = projectDir,
  env = {},
  stdin,
  mergeStderr = false,
}: {
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  mergeStderr?: boolean;
}): SecretRun => {
  const mergedPath = join(tmp, "merged-output.txt");
  const mergedFd = mergeStderr ? openSync(mergedPath, "w") : undefined;
  const result = Bun.spawnSync([...secretCommand, ...args], {
    cwd,
    env: { ...sharedEnv, ...env },
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: mergedFd ?? "pipe",
    stderr: mergedFd ?? "pipe",
  });
  if (mergedFd !== undefined) closeSync(mergedFd);
  const stripTrailingNewlines = (text: string): string => text.replace(/\n+$/, "");
  return {
    exitCode: result.exitCode,
    stdout: stripTrailingNewlines(mergedFd === undefined ? String(result.stdout) : readFileSync(mergedPath, "utf8")),
    stderr: stripTrailingNewlines(mergedFd === undefined ? String(result.stderr) : ""),
  };
};

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");
const countLines = (path: string, needle: string): number =>
  readText(path)
    .split("\n")
    .filter((line) => line.includes(needle)).length;
const resetFile = (path: string): void => writeFileSync(path, "");
const writeConfig = (dir: string, config: string): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, ".secret.json");
  writeFileSync(path, config);
  return path;
};

const fakeBw = String.raw`#!/bin/sh
case "$1" in
  status)
    printf "%s\n" "status-env:${"$"}{BW_SESSION:-EMPTY} reject=${"$"}{FAKE_BW_REJECT_UNLOCK:-0}" >> "$FAKE_LOG"
    if [ "$BW_SESSION" = "session-token-123" ] && [ -z "$FAKE_BW_REJECT_UNLOCK" ]; then
      printf '%s' '{"status":"unlocked"}'
    else
      printf "%s" "$FAKE_BW_STATUS"
    fi
    ;;
  unlock)
    read -r _ || true
    printf "%s\n" "unlock-env:${"$"}{BW_SESSION:-EMPTY}" >> "$FAKE_LOG"
    if [ -n "$FAKE_UNLOCK_EMPTY" ]; then
      printf ""
    else
      printf "%s" "session-token-123"
    fi
    ;;
  lock) printf "%s\n" "-- lock --" >> "$FAKE_LOG" ;;
  generate) printf "%s" "gen-pass-123" ;;
  sync) printf "%s\n" "-- sync --" >> "$FAKE_LOG" ;;
  serve)
    printf "%s\n" "-- serve --" >> "$FAKE_LOG"
    if [ -n "$FAKE_SERVE" ]; then
      exec "$FAKE_BUN_BIN" "$FAKE_DAEMON_FIXTURE" "$3"
    fi
    exit 1
    ;;
  list)
    printf "%s\n" "-- list items --" >> "$FAKE_LOG"
    if [ -n "$FAKE_GET_MISSING" ]; then echo "not found" >&2; exit 1; fi
    if [ -n "$FAKE_EMPTY_VAULT" ]; then printf '%s' '[]'; exit 0; fi
    printf '%s' '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass","totp":"otpauth://totp/example"},"fields":[{"name":"source","value":"https://example.com","type":0}]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"base/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/item","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"local/extra","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]'
    ;;
  get)
    if [ "$2" = "totp" ]; then printf "%s" "123456"; exit 0; fi
    printf "%s\n" "-- get $3 --" >> "$FAKE_LOG"
    if [ -n "$FAKE_GET_MISSING" ]; then echo "not found" >&2; exit 1; fi
    case "$3" in *missing*) echo "not found" >&2; exit 1 ;; esac
    printf '{"id":"item-1","name":"%s","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}' "$3"
    ;;
  create)
    printf "%s\n" "-- create --" >> "$FAKE_LOG"
    if [ -n "$FAKE_CREATE_FAIL" ]; then echo "fake create exploded" >&2; exit 1; fi
    base64 -d >> "$FAKE_LOG" 2>/dev/null
    ;;
  edit) printf "%s\n" "-- edit --" >> "$FAKE_LOG"; base64 -d >> "$FAKE_LOG" ;;
  delete) printf "%s\n" "-- delete $3 --" >> "$FAKE_LOG" ;;
esac
`;

const fakeBinaries: Record<string, string> = {
  bw: fakeBw,
  pbcopy: '#!/bin/sh\ncat > "$FAKE_CLIP"\n',
  open: "#!/bin/sh\nprintf '%s\\n' \"$1\" > \"$FAKE_OPEN\"\n",
  security: String.raw`#!/bin/bash
case "$1" in
  add-generic-password) printf '%s' "${"$"}{@: -1}" > "$FAKE_KEYCHAIN" ;;
  find-generic-password) cat "$FAKE_KEYCHAIN" 2>/dev/null || exit 44 ;;
  delete-generic-password) rm -f "$FAKE_KEYCHAIN" ;;
esac
`,
  "secret-unlock-helper": '#!/bin/sh\nprintf "%s" "session-token-123"\n',
};

const resolveSwiftSourceRoot = (): string => {
  const explicitRoot = process.env.SECRET_SOURCE_ROOT ?? join(repoRoot, "packages/secret");
  if (existsSync(join(explicitRoot, "Package.swift"))) return explicitRoot;
  const archive = Bun.spawnSync(["nix", "flake", "archive", "--json", "."], { cwd: repoRoot, stderr: "inherit" });
  const archived: { inputs: Record<string, { path: string }> } = JSON.parse(archive.stdout.toString());
  const secretCli = archived.inputs["secret-cli"];
  if (!secretCli) throw new Error("secret-cli flake input not found");
  return join(secretCli.path, "secret");
};

beforeAll(() => {
  mkdirSync(join(tmp, "bin"), { recursive: true });
  mkdirSync(join(projectDir, "sub"), { recursive: true });
  for (const [name, content] of Object.entries(fakeBinaries)) {
    writeFileSync(join(tmp, "bin", name), content, { mode: 0o755 });
  }
  writeConfig(
    projectDir,
    JSON.stringify(
      {
        secrets: {
          DATABASE_URL: { item: "myapp/database-url", field: "password" },
          "github-token": { item: "nixfiles/github-token", field: "password", env: "GITHUB_TOKEN" },
        },
        environments: {
          dev: { secrets: { DATABASE_URL: { item: "myapp/database-url-dev", field: "password" } } },
        },
      },
      null,
      2,
    ),
  );
  if (impl !== "swift") return;
  const scratchPath = join(tmp, "swift-build");
  // Inside `nix develop`, these point the system Swift at the Nix apple-sdk,
  // whose Swift module version the system compiler refuses.
  const { SDKROOT, DEVELOPER_DIR, NIX_CFLAGS_COMPILE, NIX_LDFLAGS, CC, LD, ...swiftEnvironment } = process.env;
  const build = Bun.spawnSync(
    ["swift", "build", "-c", "release", "--package-path", resolveSwiftSourceRoot(), "--scratch-path", scratchPath],
    { stdout: "ignore", stderr: "inherit", env: swiftEnvironment },
  );
  if (build.exitCode !== 0) throw new Error("swift build failed");
  secretCommand = [join(scratchPath, "release/secret")];
}, 600_000);

afterAll(() => {
  if (!process.env.KEEP_TMP) rmSync(tmp, { recursive: true, force: true });
});

describe("status and help", () => {
  test("status unlocked", () => {
    expect(runSecret({ args: ["status"] }).stdout).toBe(
      "unlocked — ready. next: secret list, or secret env --output .env",
    );
  });

  test("status locked", () => {
    expect(runSecret({ args: ["status"], env: lockedStatus }).stdout).toBe(
      "locked — unlock with: secret unlock --store",
    );
  });

  test("status unauthenticated", () => {
    expect(runSecret({ args: ["status"], env: { FAKE_BW_STATUS: '{"status":"unauthenticated"}' } }).stdout).toBe(
      "unauthenticated — run: bw login, then secret unlock --store",
    );
  });

  test("help lists all commands", () => {
    expect(runSecret({ args: ["-h"] }).stdout.replaceAll("\n", " ")).toContain(
      "status|unlock|lock|list|search|get|set|edit|id|totp|source|pull|pin|rotate|rm|unset|mv|init|env|run|print|global|prune|lint|doctor|recent|history",
    );
  });

  test("help shows the curated aliases", () => {
    const help = runSecret({ args: ["-h"] }).stdout;
    for (const curated of ["set (s, add)", "rm (delete, remove)", "source (so)", "pull (pu, sync)", "env (e)"]) {
      expect(help).toContain(curated);
    }
  });

  const envUsage =
    "Usage: secret env [--output FILE] [--env NAME] [--export] [--merge] [--diff|--dry|--dry-run] [--required a,b,c] [--optional a,b,c]";

  test("-h after a command shows that command's help", () => {
    expect(runSecret({ args: ["env", "-h"], mergeStderr: true }).stdout.split("\n")[0]).toBe(envUsage);
  });

  test("secret help env shows env help", () => {
    expect(runSecret({ args: ["help", "env"], mergeStderr: true }).stdout.split("\n")[0]).toBe(envUsage);
  });

  test("--help is accepted", () => {
    expect(runSecret({ args: ["--help"], mergeStderr: true }).stdout.split("\n")[0]).toBe(
      "Usage: secret <status|unlock|lock|list|search|get|set|edit|id|totp|source|pull|pin|rotate|rm|unset|mv|init|env|run|print|global|prune|lint|doctor|recent|history> [options]",
    );
  });
});

describe("get, source, and edit", () => {
  test("get value", () => {
    expect(runSecret({ args: ["get", "github-token"] }).stdout).toBe("old-pass");
  });

  test("source prints the stored URL", () => {
    expect(runSecret({ args: ["source", "github-token"] }).stdout).toBe("https://example.com");
  });

  test("source --open opens the stored URL", () => {
    rmSync(fakeOpen, { force: true });
    runSecret({ args: ["source", "github-token", "--open"] });
    expect(readText(fakeOpen).trimEnd()).toBe("https://example.com");
  });

  test("source --open with a new url sets and opens it", () => {
    rmSync(fakeOpen, { force: true });
    runSecret({ args: ["source", "github-token", "https://keys.example.com/rotated", "--open"] });
    expect(readText(fakeOpen).trimEnd()).toBe("https://keys.example.com/rotated");
  });

  test("source --open with a new url sends the edit payload", () => {
    expect(readText(fakeLog)).toContain("https://keys.example.com/rotated");
  });

  test("set --source stores the URL in the edited item", () => {
    runSecret({
      args: ["set", "github-token", "--force", "--source", "https://keys.example.com/new"],
      stdin: "v12\n",
    });
    expect(readText(fakeLog)).toContain("https://keys.example.com/new");
  });

  test("edit --value-stdin updates only the configured value field", () => {
    runSecret({ args: ["edit", "github-token", "--field", "password", "--value-stdin", "--force"], stdin: "v13\n" });
    expect(readText(fakeLog)).toContain("v13");
  });

  test("edit updates source, name, and notes without replacing the value", () => {
    runSecret({
      args: [
        "edit",
        "github-token",
        "--source",
        "https://keys.example.com/edit",
        "--name",
        "GitHub token",
        "--notes",
        "rotated by test",
        "--force",
      ],
    });
    const log = readText(fakeLog);
    expect(log).toContain("https://keys.example.com/edit");
    expect(log).toContain("rotated by test");
    expect(log).toContain("GitHub token");
  });

  test("edit --tags updates local alias labels", () => {
    runSecret({ args: ["edit", "github-token", "--tags", "infra,production", "--force"] });
    const config = readText(join(projectDir, ".secret.json"));
    expect(config).toContain('"tags"');
    expect(config).toContain("infra");
    expect(config).toContain("production");
  });

  test("edit --tags empty clears local alias labels", () => {
    runSecret({ args: ["edit", "github-token", "--tags", "", "--force"] });
    expect(readText(join(projectDir, ".secret.json"))).not.toContain('"tags"');
  });

  test("empty vault hints before item not found", () => {
    expect(
      runSecret({ args: ["get", "github-token"], env: { FAKE_EMPTY_VAULT: "1" }, mergeStderr: true }).stdout,
    ).toBe(
      "secret: hint: the vault is empty — create items with 'secret set <alias>', or check the account/server in bw config\nsecret: item not found for github-token: nixfiles/github-token",
    );
  });

  test("get uses a single batched bw list and never spawns bw get", () => {
    resetFile(fakeLog);
    runSecret({ args: ["get", "github-token"] });
    expect(countLines(fakeLog, "-- list items --")).toBe(1);
    expect(countLines(fakeLog, "-- get ")).toBe(0);
  });

  test("alias g maps to get", () => {
    expect(runSecret({ args: ["g", "github-token"] }).stdout).toBe("old-pass");
  });

  test("add aliases set", () => {
    expect(runSecret({ args: ["add", "github-token"], stdin: "x", mergeStderr: true }).stdout).toBe(
      "secret: item already exists; pass --force to overwrite",
    );
  });

  test("get --copy", () => {
    rmSync(fakeClip, { force: true });
    runSecret({ args: ["get", "github-token", "--copy"] });
    expect(readText(fakeClip)).toBe("old-pass");
  });
});

describe("set", () => {
  test("set blocked without force", () => {
    expect(runSecret({ args: ["set", "github-token"], stdin: "x", mergeStderr: true }).stdout).toBe(
      "secret: item already exists; pass --force to overwrite",
    );
  });

  test("set --force overwrites", () => {
    expect(runSecret({ args: ["set", "github-token", "--force"], stdin: "v2" }).exitCode).toBe(0);
  });

  test("set creates a missing item", () => {
    expect(runSecret({ args: ["set", "github-token"], stdin: "v3", env: { FAKE_GET_MISSING: "1" } }).exitCode).toBe(0);
  });

  test("create sends base64 item JSON", () => {
    expect(readText(fakeLog)).toContain('"name":"nixfiles/github-token"');
  });

  test("create failures surface bw stderr", () => {
    expect(
      runSecret({
        args: ["set", "github-token"],
        stdin: "v4",
        env: { FAKE_GET_MISSING: "1", FAKE_CREATE_FAIL: "1" },
        mergeStderr: true,
      }).stdout,
    ).toBe("secret: Bitwarden CLI request failed: fake create exploded");
  });

  const setNewDir = join(tmp, "setnew");

  test("set adds a new alias to the config", () => {
    writeConfig(setNewDir, '{"secrets":{"EXISTING":{"item":"setnew/existing"}}}');
    resetFile(fakeLog);
    runSecret({ args: ["set", "fresh-alias"], cwd: setNewDir, stdin: "s3cret\n" });
    expect(readText(join(setNewDir, ".secret.json"))).toContain('"fresh-alias"');
  });

  test("set creates source, name, and notes metadata", () => {
    runSecret({
      args: [
        "set",
        "fresh-metadata",
        "--source",
        "https://keys.example.com/fresh",
        "--name",
        "Fresh metadata",
        "--notes",
        "fresh note",
      ],
      cwd: setNewDir,
      stdin: "s4cret\n",
    });
    const log = readText(fakeLog);
    expect(log).toContain("https://keys.example.com/fresh");
    expect(log).toContain("Fresh metadata");
    expect(log).toContain("fresh note");
  });

  test("set creates the vault item for a new alias", () => {
    expect(readText(fakeLog)).toContain('"name":"setnew/fresh-alias"');
  });

  test("secure-note creation stores type, expiry, tags, and Bitwarden type 2", () => {
    const typedConfig = writeConfig(join(tmp, "typed"), '{"secrets":{}}');
    runSecret({
      args: [
        "set",
        "ssh-private-key",
        "--config",
        typedConfig,
        "--type",
        "secure-note",
        "--field",
        "notes",
        "--tags",
        "infra,ssh",
        "--expires-at",
        "2030-01-01",
      ],
      cwd: setNewDir,
      stdin: "ssh-private-key-content\n",
      env: { FAKE_GET_MISSING: "1" },
    });
    const config = readText(typedConfig);
    expect(config).toContain('"type": "secure-note"');
    expect(config).toContain('"expiresAt": "2030-01-01"');
    expect(config).toContain('"tags": [');
    expect(readText(fakeLog)).toContain('"type":2');
  });

  test("non-production set writes the alias under the selected environment", () => {
    const envTypedConfig = writeConfig(join(tmp, "envtyped"), '{"secrets":{}}');
    runSecret({
      args: ["set", "staging-only", "--config", envTypedConfig, "--env", "staging"],
      cwd: setNewDir,
      stdin: "staging-value\n",
      env: { FAKE_GET_MISSING: "1" },
    });
    const config = readText(envTypedConfig);
    expect(config).toContain('"environments"');
    expect(config).toContain('"staging-only"');
  });

  test("set --generate delivers value to clipboard", () => {
    rmSync(fakeClip, { force: true });
    expect(runSecret({ args: ["set", "github-token", "--generate", "--force"] }).exitCode).toBe(0);
    expect(readText(fakeClip)).toBe("gen-pass-123");
  });
});

describe("id, totp, pull, status --check", () => {
  test("id resolves item id", () => {
    expect(runSecret({ args: ["id", "github-token"] }).stdout).toBe("item-1");
  });

  test("get of an unknown alias fails", () => {
    expect(runSecret({ args: ["get", "nope"] }).exitCode).not.toBe(0);
  });

  test("totp code", () => {
    expect(runSecret({ args: ["totp", "github-token"] }).stdout).toBe("123456");
  });

  test("totp --copy", () => {
    rmSync(fakeClip, { force: true });
    runSecret({ args: ["totp", "github-token", "--copy"] });
    expect(readText(fakeClip)).toBe("123456");
  });

  test.each(["pull", "pu", "sync"])("%s succeeds", (command) => {
    expect(runSecret({ args: [command] }).exitCode).toBe(0);
  });

  test("status --check exits 0 when unlocked", () => {
    expect(runSecret({ args: ["status", "--check"] }).exitCode).toBe(0);
  });

  test("status --check exits nonzero when locked", () => {
    expect(runSecret({ args: ["status", "--check"], env: lockedStatus }).exitCode).not.toBe(0);
  });
});

describe("env", () => {
  test("list picks dev item", () => {
    const listed = runSecret({ args: ["list", "--env", "dev"] }).stdout;
    expect(listed.split("\n").filter((line) => line.includes("database-url-dev"))).toHaveLength(1);
  });

  test("unknown env rejected", () => {
    expect(runSecret({ args: ["env", "--env", "staging", "--output", "x"], mergeStderr: true }).stdout).toBe(
      "secret: unknown environment: staging (available: prod, dev)",
    );
  });

  test("env --env dev writes a file", () => {
    expect(runSecret({ args: ["env", "--env", "dev", "--output", ".env.dev"] }).exitCode).toBe(0);
  });

  test("env --required fails on missing alias", () => {
    expect(
      runSecret({ args: ["env", "--required", "DATABASE_URL,STRIPE_KEY", "--output", "x"], mergeStderr: true }).stdout,
    ).toBe("secret: required alias(es) not in project config: STRIPE_KEY (add them to .secret.json)");
  });

  test("env --required passes when aliases exist", () => {
    expect(runSecret({ args: ["env", "--required", "DATABASE_URL", "--output", ".env"] }).exitCode).toBe(0);
  });

  test("env batches all aliases into one bw list and never calls bw get", () => {
    resetFile(fakeLog);
    expect(runSecret({ args: ["env", "--output", ".env"] }).exitCode).toBe(0);
    expect(countLines(fakeLog, "-- list items --")).toBe(1);
    expect(countLines(fakeLog, "-- get ")).toBe(0);
  });
});

describe("pin", () => {
  test("pin resolves item ids from one bw list and rewrites names to ids", () => {
    resetFile(fakeLog);
    expect(runSecret({ args: ["pin", "DATABASE_URL"] }).exitCode).toBe(0);
    expect(countLines(fakeLog, "-- list items --")).toBe(1);
    expect(readText(join(projectDir, ".secret.json"))).toContain('"item": "item-1"');
  });

  test("pin of an unknown alias fails", () => {
    expect(runSecret({ args: ["pin", "nope"] }).exitCode).not.toBe(0);
  });
});

describe("rotate and rm", () => {
  test("rotate blocked without force", () => {
    expect(runSecret({ args: ["rotate", "github-token"], mergeStderr: true }).stdout).toBe(
      "secret: item already exists; pass --force to overwrite",
    );
  });

  test("rotate edits the vault item and delivers the new value to the clipboard", () => {
    expect(runSecret({ args: ["rotate", "github-token", "--force"] }).exitCode).toBe(0);
    expect(readText(fakeLog)).toContain("-- edit --");
    expect(readText(fakeClip)).toBe("gen-pass-123");
  });

  test.each(["rm", "delete", "remove"])("%s is blocked without force", (command) => {
    expect(runSecret({ args: [command, "github-token"], mergeStderr: true }).stdout).toBe(
      "secret: refusing to delete nixfiles/github-token without confirmation; pass --force",
    );
  });

  test("rm --force deletes the vault item", () => {
    expect(runSecret({ args: ["rm", "github-token", "--force"] }).exitCode).toBe(0);
    expect(readText(fakeLog)).toContain("-- delete nixfiles/github-token --");
  });

  test("rm missing item", () => {
    expect(
      runSecret({ args: ["rm", "github-token", "--force"], env: { FAKE_GET_MISSING: "1" }, mergeStderr: true }).stdout,
    ).toBe("secret: item not found for github-token: nixfiles/github-token");
  });

  test("rm falls back to unset when the item is confirmed missing", () => {
    const rmEmptyDir = join(tmp, "rmempty");
    writeConfig(rmEmptyDir, '{"secrets":{"GH":{"item":"rm/gh"}}}');
    expect(
      runSecret({
        args: ["rm", "GH", "--force"],
        cwd: rmEmptyDir,
        env: { FAKE_EMPTY_VAULT: "1" },
        mergeStderr: true,
      }).stdout,
    ).toBe("secret: item not found in vault — removed GH from config");
    expect(readText(join(rmEmptyDir, ".secret.json"))).not.toContain('"GH"');
  });

  test("rotate of an unknown alias fails", () => {
    expect(runSecret({ args: ["rotate", "nope"] }).exitCode).not.toBe(0);
  });
});

describe("doctor", () => {
  test("doctor succeeds", () => {
    expect(runSecret({ args: ["doctor"] }).exitCode).toBe(0);
  });

  test("doctor --json exposes value-free remote metadata and TOTP state", () => {
    const report = runSecret({ args: ["doctor", "--json", "--config", join(projectDir, ".secret.json")] }).stdout;
    expect(report).toMatch(
      /"alias":"github-token".*"status":"ok".*"itemName":"nixfiles\/github-token".*"source":"https:\/\/example\.com".*"hasTOTP":"true"/,
    );
    expect(report).not.toMatch(/old-pass|otpauth:\/\//);
  });

  test("doctor --json reports missing remote items", () => {
    const missingRemote = join(tmp, "missing-remote.json");
    writeFileSync(missingRemote, '{"secrets":{"missing":{"item":"not/in-vault"}}}');
    expect(runSecret({ args: ["doctor", "--json", "--config", missingRemote] }).stdout).toMatch(
      /"alias":"missing".*"status":"missing"/,
    );
  });

  test("doctor reports daemon state", () => {
    expect(runSecret({ args: ["doctor"] }).stdout).toContain("daemon\tdisabled");
  });

  test("doctor fails when vault items are unreachable", () => {
    expect(runSecret({ args: ["doctor"], env: { FAKE_GET_MISSING: "1" } }).exitCode).not.toBe(0);
  });

  test("doctor locked hint", () => {
    expect(runSecret({ args: ["doctor"], env: lockedStatus, mergeStderr: true }).stdout.split("\n")[0]).toBe(
      "bitwarden: locked — unlock with: secret unlock --store",
    );
  });
});

describe("lint", () => {
  test("lint passes on the project config", () => {
    expect(runSecret({ args: ["lint"] }).exitCode).toBe(0);
  });

  test("lint flags env-key collision", () => {
    const collide = join(tmp, "collide.json");
    writeFileSync(collide, '{"secrets":{"A":{"item":"x/a"},"B":{"item":"x/b","env":"A"}}}');
    const linted = runSecret({ args: ["lint", "--config", collide], mergeStderr: true });
    expect(linted.exitCode).not.toBe(0);
    expect(linted.stdout.split("\n")[0]).toBe("project\tB\tdotenv key A collides with project:A (last wins silently)");
  });

  test("lint flags invalid dotenv key", () => {
    const badKey = join(tmp, "badkey.json");
    writeFileSync(badKey, '{"secrets":{"BAD-NAME":{"item":"x/bad"}}}');
    const linted = runSecret({ args: ["lint", "--config", badKey], mergeStderr: true });
    expect(linted.exitCode).not.toBe(0);
    expect(linted.stdout.split("\n")[0]).toBe('project\tBAD-NAME\tinvalid dotenv key (add an explicit "env" field)');
  });

  test("lint --json rows", () => {
    const missingItem = join(tmp, "missing.json");
    writeFileSync(missingItem, '{"secrets":{"X":{}}}');
    expect(runSecret({ args: ["lint", "--config", missingItem] }).exitCode).not.toBe(0);
    expect(runSecret({ args: ["lint", "--config", missingItem, "--json"] }).stdout).toBe(
      '[{"scope":"project","alias":"X","message":"invalid definition (missing item)"}]',
    );
  });
});

describe("print, global, prune, search, list", () => {
  const projectPrint =
    "DATABASE_URL\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN";

  test("print project scope after pin", () => {
    expect(runSecret({ args: ["print"] }).stdout).toBe(projectPrint);
  });

  test("alias pr maps to print", () => {
    expect(runSecret({ args: ["pr"] }).stdout).toBe(projectPrint);
  });

  test.each([{ args: ["print", "global"] }, { args: ["global"] }])("$args explains the missing global config", ({ args }) => {
    expect(runSecret({ args, mergeStderr: true }).stdout).toBe(
      `secret: no config file for global scope: ${globalConfig}`,
    );
  });

  test("set --global writes the user config and global lists it", () => {
    runSecret({ args: ["set", "--global", "global-alias"], stdin: "gv\n" });
    expect(readText(globalConfig)).toContain('"global-alias"');
    expect(runSecret({ args: ["global"] }).stdout.split("\n")[0]?.split("\t")[0]).toBe("global-alias");
  });

  test("secret global add and unset edit the user config", () => {
    runSecret({ args: ["unset", "--global", "global-alias"] });
    runSecret({ args: ["global", "add", "ga2"], stdin: "gv\n" });
    expect(readText(globalConfig)).toContain('"ga2"');
    runSecret({ args: ["global", "unset", "ga2"] });
    expect(readText(globalConfig)).not.toContain('"ga2"');
  });

  test("set scopes a colliding alias to the selected repo config", () => {
    const scopeConfig = writeConfig(join(tmp, "scope-project"), '{"secrets":{}}');
    runSecret({ args: ["set", "--config", scopeConfig, "shared-alias"], stdin: "scope-value\n" });
    expect(readText(scopeConfig)).toContain('"shared-alias"');
    expect(readText(fakeLog)).toContain('"name":"scope-project/shared-alias"');
  });

  test("prune --dry-run leaves the config untouched, prune removes only missing aliases", () => {
    const pruneDir = join(tmp, "prunedir");
    const pruneConfig = writeConfig(
      pruneDir,
      '{"secrets":{"KEEP":{"item":"nixfiles/github-token"},"GONE":{"item":"nope/missing"}}}',
    );
    expect(runSecret({ args: ["prune", "--dry-run"], cwd: pruneDir }).exitCode).toBe(0);
    expect(readText(pruneConfig)).toContain('"GONE"');
    expect(runSecret({ args: ["prune"], cwd: pruneDir }).exitCode).toBe(0);
    expect(readText(pruneConfig)).not.toContain('"GONE"');
    expect(readText(pruneConfig)).toContain('"KEEP"');
  });

  test("print rejects unknown scope", () => {
    expect(runSecret({ args: ["print", "bogus"], mergeStderr: true }).stdout).toBe(
      "secret: unknown scope: bogus (available: project, global, local)",
    );
  });

  test("print --all merges scopes", () => {
    expect(runSecret({ args: ["print", "--all"] }).stdout).toBe(
      "DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL\ngithub-token\tproject\tprod\tnixfiles/github-token\tpassword\tGITHUB_TOKEN",
    );
  });

  test("search matches alias and env key", () => {
    expect(runSecret({ args: ["search", "database"] }).stdout).toBe(
      "DATABASE_URL\tproject\tdev\titem-1\tpassword\tDATABASE_URL\nDATABASE_URL\tproject\tprod\titem-1\tpassword\tDATABASE_URL",
    );
  });

  test("search --json rows", () => {
    expect(runSecret({ args: ["search", "github", "--json"] }).stdout).toBe(
      '[{"alias":"github-token","scope":"project","env":"prod","item":"nixfiles/github-token","field":"password","envKey":"GITHUB_TOKEN"}]',
    );
  });

  test("search no match exits nonzero", () => {
    const searched = runSecret({ args: ["search", "nope"], mergeStderr: true });
    expect(searched.exitCode).not.toBe(0);
    expect(searched.stdout).toBe("secret search: no matches for 'nope'. next: try another term, or 'secret print --all'");
  });

  test("print --json rows after pin", () => {
    expect(runSecret({ args: ["print", "--json"] }).stdout).toBe(
      '[{"alias":"DATABASE_URL","env":"dev","item":"item-1","field":"password","envKey":"DATABASE_URL"},{"alias":"DATABASE_URL","env":"prod","item":"item-1","field":"password","envKey":"DATABASE_URL"},{"alias":"github-token","env":"prod","item":"nixfiles/github-token","field":"password","envKey":"GITHUB_TOKEN"}]',
    );
  });

  test("list --json merged aliases after pin", () => {
    expect(runSecret({ args: ["list", "--json"] }).stdout).toBe(
      '[{"alias":"DATABASE_URL","item":"item-1","field":"password","envKey":"DATABASE_URL","createdAt":"2026-01-15T10:00:00.000Z","source":"","hasTOTP":"false"},{"alias":"github-token","item":"nixfiles/github-token","field":"password","envKey":"GITHUB_TOKEN","createdAt":"2026-01-15T10:00:00.000Z","source":"https://example.com","hasTOTP":"true"}]',
    );
  });

  test.skipIf(!Bun.which("script"))("list prints a table with created dates on a TTY, fetching items once", () => {
    resetFile(fakeLog);
    const transcript = join(tmp, "list-tty.txt");
    Bun.spawnSync(["script", "-q", transcript, ...secretCommand, "list"], { cwd: projectDir, env: sharedEnv });
    const table = readText(transcript).replace(/[\r\b]/g, "");
    for (const expected of ["ALIAS", "CREATED AT", "SOURCE", "https://example.com"]) {
      expect(table).toContain(expected);
    }
    expect(table).toMatch(/2026-01-15 \d{2}:\d{2}/);
    expect(countLines(fakeLog, "-- list items --")).toBe(1);
  });
});

describe("env output modes", () => {
  test("env --export shell lines with source comments", () => {
    expect(runSecret({ args: ["env", "--export"] }).stdout).toBe(
      "export DATABASE_URL='old-pass'\n# source: https://example.com\nexport GITHUB_TOKEN='old-pass'",
    );
  });

  test("env --diff shows changed keys without exposing values, aliased by --dry/--dry-run", () => {
    const dotenv = join(projectDir, ".env");
    writeFileSync(dotenv, "DATABASE_URL='stale'\n");
    const diff = runSecret({ args: ["env", "--diff", "--output", ".env"] }).stdout;
    expect(diff).toBe("~ DATABASE_URL\n+ GITHUB_TOKEN");
    expect(runSecret({ args: ["env", "--dry", "--output", ".env"] }).stdout).toBe(diff);
    expect(runSecret({ args: ["env", "--dry-run", "--output", ".env"] }).stdout).toBe(diff);
    expect(readText(dotenv).trimEnd()).toBe("DATABASE_URL='stale'");
  });

  test("env works from a project subdirectory", () => {
    expect(runSecret({ args: ["env", "--output", ".env"], cwd: join(projectDir, "sub") }).exitCode).toBe(0);
  });
});

describe("mv and unset", () => {
  const notInConfig = (alias: string): string =>
    `secret: alias ${alias} is not in a project, local, or user config (see 'secret print --all')`;

  test("mv renames base and env overrides", () => {
    expect(runSecret({ args: ["mv", "DATABASE_URL", "DB_URL"] }).exitCode).toBe(0);
    expect(runSecret({ args: ["print"] }).stdout.split("\n")[0]).toBe("DB_URL\tdev\titem-1\tpassword\tDB_URL");
    expect(runSecret({ args: ["mv", "DB_URL", "DATABASE_URL"] }).exitCode).toBe(0);
  });

  test("mv rejects invalid alias name", () => {
    expect(runSecret({ args: ["mv", "DATABASE_URL", "9BAD"], mergeStderr: true }).stdout).toBe(
      "secret: invalid alias name: 9BAD (letters, digits, underscore, hyphen; must not start with a digit)",
    );
  });

  test("mv refuses alias not in config", () => {
    expect(runSecret({ args: ["mv", "nope", "GH"], mergeStderr: true }).stdout).toBe(notInConfig("nope"));
  });

  test("unset removes the alias, a second unset reports it missing", () => {
    expect(runSecret({ args: ["unset", "DATABASE_URL"] }).exitCode).toBe(0);
    expect(runSecret({ args: ["get", "DATABASE_URL"] }).exitCode).not.toBe(0);
    expect(runSecret({ args: ["unset", "DATABASE_URL"], mergeStderr: true }).stdout).toBe(notInConfig("DATABASE_URL"));
  });

  test("unset refuses alias not in config", () => {
    expect(runSecret({ args: ["unset", "nope"], mergeStderr: true }).stdout).toBe(notInConfig("nope"));
  });
});

describe("history and recent", () => {
  beforeAll(() => {
    runSecret({ args: ["get", "github-token"] });
  });

  test("history records get", () => {
    expect(runSecret({ args: ["history"] }).stdout).toMatch(/get.*github-token/);
  });

  test("recent lists used alias", () => {
    expect(runSecret({ args: ["recent"] }).stdout).toContain("github-token");
  });

  test("history --json rows", () => {
    expect(runSecret({ args: ["history", "--json"] }).stdout).toContain('"cmd":"get"');
  });

  test("recent --json rows", () => {
    expect(runSecret({ args: ["recent", "--json"] }).stdout).toContain('"alias":"github-token"');
  });
});

describe("init", () => {
  const initDir = join(tmp, "initdir");
  const initConfig = join(initDir, ".secret.json");

  test("init scaffolds with directory prefix", () => {
    mkdirSync(initDir, { recursive: true });
    expect(runSecret({ args: ["init"], cwd: initDir }).exitCode).toBe(0);
    expect(readText(initConfig)).toContain('"item": "initdir/example"');
  });

  test("init refuses overwrite without --force", () => {
    expect(runSecret({ args: ["init"], cwd: initDir, mergeStderr: true }).stdout).toBe(
      `secret: .secret.json already exists (use --force to overwrite): ${realpathSync(initDir)}/.secret.json`,
    );
  });

  test("print after init --force", () => {
    expect(runSecret({ args: ["init", "--force"], cwd: initDir }).exitCode).toBe(0);
    expect(runSecret({ args: ["print"], cwd: initDir }).stdout).toBe("EXAMPLE\tprod\tinitdir/example\tpassword\tEXAMPLE");
  });

  test("init prefills the given aliases", () => {
    expect(runSecret({ args: ["init", "--force", "API_TOKEN", "STRIPE_KEY"], cwd: initDir }).exitCode).toBe(0);
    const config = readText(initConfig);
    for (const expected of ["API_TOKEN", "STRIPE_KEY", "initdir/api-token", "initdir/stripe-key"]) {
      expect(config).toContain(expected);
    }
  });

  test("init rejects invalid alias", () => {
    expect(runSecret({ args: ["init", "--force", "9BAD"], cwd: initDir, mergeStderr: true }).stdout).toBe(
      "secret: invalid alias name: 9BAD (letters, digits, underscore, hyphen; must not start with a digit)",
    );
  });

  test("mv refuses rename onto existing alias", () => {
    expect(runSecret({ args: ["mv", "API_TOKEN", "STRIPE_KEY"], cwd: initDir, mergeStderr: true }).stdout).toBe(
      `secret: alias STRIPE_KEY already exists in ${realpathSync(initDir)}/.secret.json`,
    );
  });

  test("print outside project suggests init", () => {
    expect(runSecret({ args: ["print"], cwd: tmp, mergeStderr: true }).stdout).toBe(
      "secret: no .secret.json found (searched up to $HOME) — run 'secret init' to scaffold one, or pass --config FILE",
    );
  });
});

describe("local overrides and run", () => {
  const localDir = join(tmp, "localdir");
  const localConfig = join(localDir, ".secret.local.json");

  beforeAll(() => {
    writeConfig(localDir, '{"secrets":{"BASE":{"item":"base/item"}}}');
    writeFileSync(localConfig, '{"secrets":{"BASE":{"item":"local/item"},"EXTRA":{"item":"local/extra"}}}');
  });

  test("local overrides project item and adds alias", () => {
    expect(runSecret({ args: ["list"], cwd: localDir }).stdout).toBe(
      "BASE\tlocal/item\tpassword\nEXTRA\tlocal/extra\tpassword",
    );
  });

  test("env includes local aliases", () => {
    expect(runSecret({ args: ["env", "--export"], cwd: localDir }).stdout).toBe(
      "export BASE='old-pass'\nexport EXTRA='old-pass'",
    );
  });

  test("print local scope", () => {
    expect(runSecret({ args: ["print", "local"], cwd: localDir }).stdout.split("\n")[0]).toBe(
      "BASE\tprod\tlocal/item\tpassword\tBASE",
    );
  });

  test("lint passes with a local config", () => {
    expect(runSecret({ args: ["lint"], cwd: localDir }).exitCode).toBe(0);
  });

  test("pin edits the local config", () => {
    expect(runSecret({ args: ["pin", "EXTRA"], cwd: localDir }).exitCode).toBe(0);
    expect(readText(localConfig)).toContain('"item": "item-1"');
  });

  test("unset removes from the local config", () => {
    expect(runSecret({ args: ["unset", "EXTRA"], cwd: localDir }).exitCode).toBe(0);
    expect(readText(localConfig)).not.toContain('"EXTRA"');
  });

  test("local item wins", () => {
    expect(runSecret({ args: ["get", "BASE"], cwd: localDir }).stdout).toBe("old-pass");
  });

  test("run injects env and scrubs secret values from output", () => {
    expect(runSecret({ args: ["run", "--", "sh", "-c", "echo $BASE"], cwd: localDir }).stdout).toBe("[scrubbed]");
  });

  test("run propagates the child exit code", () => {
    expect(runSecret({ args: ["run", "--", "sh", "-c", "exit 3"], cwd: localDir }).exitCode).toBe(3);
  });

  test("run without a command fails", () => {
    expect(runSecret({ args: ["run"], cwd: localDir }).exitCode).not.toBe(0);
  });
});

describe("optional aliases", () => {
  const optionalDir = join(tmp, "optdir");

  beforeAll(() => {
    writeConfig(optionalDir, '{"secrets":{"BASE":{"item":"base/item"},"BROKEN":{"item":"base/missing"}}}');
  });

  test("run fails on an unresolved alias", () => {
    expect(runSecret({ args: ["run", "--", "sh", "-c", "echo hi"], cwd: optionalDir }).exitCode).not.toBe(0);
  });

  test("run --optional skips unresolved aliases (output scrubbed)", () => {
    expect(
      runSecret({ args: ["run", "--optional", "BROKEN", "--", "sh", "-c", "echo $BASE"], cwd: optionalDir }).stdout,
    ).toBe("[scrubbed]");
  });

  test("env --optional skips unresolved aliases", () => {
    expect(runSecret({ args: ["env", "--optional", "BROKEN", "--export"], cwd: optionalDir }).stdout).toBe(
      "export BASE='old-pass'",
    );
  });

  test("env lists all missing aliases in the optional hint", () => {
    const missingDir = join(tmp, "envmiss");
    writeConfig(missingDir, '{"secrets":{"A":{"item":"x/a"},"B":{"item":"x/b"}}}');
    expect(runSecret({ args: ["env"], cwd: missingDir, mergeStderr: true }).stdout).toBe(
      "secret: hint: pass --optional A,B to skip unresolved aliases\nsecret: item not found for A: x/a",
    );
  });
});

describe("daemon mode (bw serve over a unix socket)", () => {
  const daemonStatus = "unlocked — ready. next: secret list, or secret env --output .env (daemon up)";

  beforeAll(() => {
    const daemonItems = join(tmp, "daemon-items.json");
    writeFileSync(
      daemonItems,
      '[{"id":"item-1","name":"myapp/database-url","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]},{"id":"item-1","name":"nixfiles/github-token","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[{"name":"source","value":"https://example.com","type":0}]},{"id":"item-1","name":"myapp/database-url-dev","creationDate":"2026-01-15T10:00:00.000Z","login":{"password":"old-pass"},"fields":[]}]',
    );
    Object.assign(sharedEnv, {
      SECRET_DAEMON: "1",
      FAKE_SERVE: "1",
      FAKE_DAEMON_FIXTURE: join(import.meta.dir, "test-daemon.ts"),
      FAKE_DAEMON_ITEMS: daemonItems,
      FAKE_DAEMON_LOG: daemonLog,
      FAKE_DAEMON_MISSING: daemonMissing,
    });
    resetFile(daemonLog);
    resetFile(fakeLog);
  });

  afterAll(() => {
    runSecret({ args: ["lock"] });
    Object.assign(sharedEnv, { SECRET_DAEMON: "0", FAKE_SERVE: "0" });
  });

  test("daemon status reports the daemon", () => {
    expect(runSecret({ args: ["status"] }).stdout).toBe(daemonStatus);
  });

  test("daemon get via HTTP", () => {
    expect(runSecret({ args: ["get", "github-token"] }).stdout).toBe("old-pass");
  });

  test("daemon env via HTTP", () => {
    expect(runSecret({ args: ["env", "--export"] }).stdout).toBe(
      "# source: https://example.com\nexport GITHUB_TOKEN='old-pass'",
    );
  });

  test("daemon run via HTTP (output scrubbed)", () => {
    expect(runSecret({ args: ["run", "--", "sh", "-c", "echo $GITHUB_TOKEN"] }).stdout).toBe("[scrubbed]");
  });

  test("daemon is spawned once, never spawns bw get, and serves three item lists", () => {
    expect(countLines(fakeLog, "-- serve --")).toBe(1);
    expect(countLines(fakeLog, "-- get ")).toBe(0);
    expect(countLines(daemonLog, "GET /list/object/items")).toBe(3);
  });

  test("denied daemon requests fail reads and fall back to spawn status", () => {
    writeFileSync(daemonMissing, "");
    expect(runSecret({ args: ["env", "--output", "x"] }).exitCode).not.toBe(0);
    expect(runSecret({ args: ["status"], env: lockedStatus }).stdout).toBe(
      "locked — unlock with: secret unlock --store",
    );
    rmSync(daemonMissing, { force: true });
  });

  test("daemon recovers after denied requests (output scrubbed)", () => {
    expect(runSecret({ args: ["run", "--", "sh", "-c", "echo $GITHUB_TOKEN"] }).stdout).toBe("[scrubbed]");
  });

  test("pull uses the daemon sync instead of spawning bw sync", () => {
    resetFile(fakeLog);
    resetFile(daemonLog);
    expect(runSecret({ args: ["pull"] }).exitCode).toBe(0);
    expect(readText(daemonLog)).toContain("POST /sync");
    expect(countLines(fakeLog, "-- sync --")).toBe(0);
  });

  test("set edits via the daemon instead of spawning bw edit", () => {
    runSecret({ args: ["set", "github-token", "--force"], stdin: "v9\n" });
    expect(readText(daemonLog)).toContain("PUT /object/item/item-1");
    expect(countLines(fakeLog, "-- edit --")).toBe(0);
  });

  test("rotate generates via the daemon", () => {
    expect(runSecret({ args: ["rotate", "github-token", "--force"] }).exitCode).toBe(0);
    expect(readText(daemonLog)).toContain("GET /generate");
  });

  test("rm deletes via the daemon instead of spawning bw delete", () => {
    expect(runSecret({ args: ["rm", "github-token", "--force"] }).exitCode).toBe(0);
    expect(readText(daemonLog)).toContain("DELETE /object/item/item-1");
    expect(countLines(fakeLog, "-- delete ")).toBe(0);
  });

  test("set creates via the daemon", () => {
    const daemonSetDir = join(tmp, "daemon-set");
    writeConfig(daemonSetDir, '{"secrets":{"new-alias":{"item":"new/item"}}}');
    runSecret({ args: ["set", "new-alias"], cwd: daemonSetDir, stdin: "v10\n" });
    expect(readText(daemonLog)).toContain("POST /object/item");
  });

  test("lock spawns bw lock and removes the daemon socket and state", () => {
    resetFile(fakeLog);
    expect(runSecret({ args: ["lock"] }).exitCode).toBe(0);
    expect(countLines(fakeLog, "-- lock --")).toBe(1);
    expect(existsSync(join(tmp, ".config/secret/daemon/bw.sock"))).toBe(false);
    expect(existsSync(join(tmp, ".config/secret/daemon/daemon.json"))).toBe(false);
  });

  test("Touch ID helper keeps its token out of stdout and leaves a reusable unlocked daemon", () => {
    expect(runSecret({ args: ["unlock", "--helper"] }).stdout).toBe("");
    expect(runSecret({ args: ["status"] }).stdout).toBe(daemonStatus);
    expect(runSecret({ args: ["get", "github-token"] }).stdout).toBe("old-pass");
    expect(runSecret({ args: ["lock"] }).exitCode).toBe(0);
  });
});

describe("unlock and session storage", () => {
  test("unlock prints raw session token", () => {
    expect(runSecret({ args: ["unlock"], cwd: tmp }).stdout).toBe("session-token-123");
  });

  test("unlock --helper uses the Touch ID session", () => {
    expect(runSecret({ args: ["unlock", "--helper"], cwd: tmp }).stdout).toBe("session-token-123");
  });

  test.skipIf(!Bun.which("expect"))("graceful re-unlock prompts and rotates a locked vault", () => {
    const transcript = join(tmp, "reunlock.txt");
    const expectScript = join(tmp, "reunlock.exp");
    writeFileSync(
      expectScript,
      [
        "set timeout 30",
        `log_file -a ${transcript}`,
        `spawn env FAKE_BW_STATUS={"status":"locked"} PATH=${sharedEnv.PATH} HOME=${tmp} SECRET_DAEMON=0 ${secretCommand.join(" ")} rotate github-token --force`,
        'send "mp\\r"',
        'expect "rotated"',
        "",
      ].join("\n"),
    );
    resetFile(fakeKeychain);
    Bun.spawnSync(["expect", expectScript], { cwd: projectDir, env: sharedEnv });
    const output = readText(transcript).replace(/\x1b\[[0-9;]*m/g, "");
    expect(output).not.toContain("Bitwarden is locked");
    expect(output).toContain("rotated");
  });

  test("unlock ignores stale env and always prompts for a fresh session", () => {
    resetFile(fakeLog);
    expect(runSecret({ args: ["unlock"], cwd: tmp, env: { BW_SESSION: "stale-token" } }).stdout).toBe(
      "session-token-123",
    );
    expect(countLines(fakeLog, "unlock-env:")).toBe(1);
  });

  test("unlock --store persists a fresh session, ignoring stale env", () => {
    resetFile(fakeKeychain);
    runSecret({ args: ["unlock", "--store"], cwd: tmp, env: { BW_SESSION: "stale-dead-token" } });
    expect(readText(fakeKeychain)).toBe("session-token-123");
  });

  test("rejected fresh session should warn-and-store", () => {
    const rejected = runSecret({
      args: ["unlock", "--store"],
      cwd: tmp,
      env: { ...lockedStatus, FAKE_BW_REJECT_UNLOCK: "1" },
      mergeStderr: true,
    }).stdout;
    expect(rejected).toMatch(/bw status did not confirm the new session[\s\S]*unlocked; session stored/);
  });

  test("unlock refuses to store an empty token", () => {
    expect(
      runSecret({ args: ["unlock", "--store"], cwd: tmp, env: { FAKE_UNLOCK_EMPTY: "1" }, mergeStderr: true }).stdout,
    ).toBe("secret: bw unlock returned no session token");
  });

  test("unlock warns on stderr when bw rejects the fresh session", () => {
    expect(
      runSecret({ args: ["unlock", "--store"], cwd: tmp, env: { ...lockedStatus, FAKE_BW_REJECT_UNLOCK: "1" } }).stderr,
    ).toContain("did not confirm the new session");
  });

  test("unlock --store keeps token off stdout", () => {
    expect(runSecret({ args: ["unlock", "--store"], cwd: tmp }).stdout).toBe("");
  });

  test("status hints when a present session is rejected", () => {
    expect(runSecret({ args: ["status"], cwd: tmp, env: { ...lockedStatus, BW_SESSION: "x" } }).stderr).toContain(
      "session token is present but bw rejects it",
    );
  });

  test("unlock --store persists the session", () => {
    const storedSession = isDarwin ? fakeKeychain : join(tmp, ".config/secret/session");
    expect(readText(storedSession)).toBe("session-token-123");
  });

  test("status locked keeps stdout unchanged and hints at a stale stored session", () => {
    const locked = runSecret({ args: ["status"], cwd: tmp, env: lockedStatus });
    expect(locked.stdout).toBe("locked — unlock with: secret unlock --store");
    expect(locked.stderr).toContain("stale");
  });

  test("lock calls bw lock and clears the stored session", () => {
    expect(runSecret({ args: ["lock"], cwd: tmp }).exitCode).toBe(0);
    expect(readText(fakeLog)).toContain("-- lock --");
    expect(existsSync(isDarwin ? fakeKeychain : join(tmp, ".config/secret/session"))).toBe(false);
  });
});

describe("backend selection, env --export, scrubbing, check", () => {
  const backendDir = join(tmp, "bd");

  beforeAll(() => {
    writeConfig(backendDir, '{"secrets":{"DATABASE_URL":{"item":"myapp/database-url"}}}');
  });

  test("unknown backend fails with available list", () => {
    writeFileSync(globalConfig, '{ "backend": "doesnotexist" }\n');
    expect(runSecret({ args: ["status"], cwd: backendDir, mergeStderr: true }).stdout).toBe(
      "secret: unknown vault backend 'doesnotexist' (available: bitwarden, keychain)",
    );
  });

  test("env --export output evals to the secret value", () => {
    writeFileSync(globalConfig, "{}\n");
    const exportLines = runSecret({ args: ["env", "--export"], cwd: backendDir }).stdout;
    expect(exportLines.split("\n").filter((line) => line.startsWith("export DATABASE_URL="))).toHaveLength(1);
    const evaluated = Bun.spawnSync(["sh", "-c", `${exportLines}\nprintf '%s' "$DATABASE_URL"`]);
    expect(evaluated.stdout.toString()).toBe("old-pass");
  });

  test("run scrubs secret values from stdout", () => {
    const scrubbed = runSecret({ args: ["run", "--", "sh", "-c", 'echo "leak: $DATABASE_URL"'], cwd: backendDir }).stdout;
    expect(scrubbed).not.toContain("old-pass");
    expect(scrubbed).toContain("leak: [scrubbed]");
  });

  test("check exits 0 and prints a summary when all aliases resolve", () => {
    const checked = runSecret({ args: ["check"], cwd: backendDir, mergeStderr: true });
    expect(checked.exitCode).toBe(0);
    expect(checked.stdout).toContain("aliases ok");
  });

  test("check exits 1 and flags an expired secret", () => {
    writeConfig(backendDir, '{"secrets":{"DATABASE_URL":{"item":"myapp/database-url","expiresAt":"2020-01-01"}}}');
    const checked = runSecret({ args: ["check"], cwd: backendDir, mergeStderr: true });
    expect(checked.exitCode).not.toBe(0);
    expect(checked.stdout).toMatch(/expired[\s\S]*DATABASE_URL/);
  });
});

describe.skipIf(impl !== "swift" || !process.env.RUN_KEYCHAIN_TESTS)("keychain backend roundtrip (opt-in)", () => {
  const keychainEnv = { SECRET_KEYCHAIN_SERVICE: `dev.astahmer.secret-tests-${process.pid}` };
  const backendDir = join(tmp, "bd");

  beforeAll(() => {
    writeFileSync(globalConfig, '{ "backend": "keychain" }');
  });

  test("keychain set, update, and delete roundtrip", () => {
    const setItem = (value: string): SecretRun =>
      runSecret({ args: ["set", "kc/test-item", "--force"], cwd: backendDir, env: keychainEnv, stdin: `${value}\n` });
    const getItem = (): SecretRun => runSecret({ args: ["get", "kc/test-item"], cwd: backendDir, env: keychainEnv });
    expect(setItem("kc-pass-42").exitCode).toBe(0);
    expect(getItem().stdout).toBe("kc-pass-42");
    setItem("kc-pass-43");
    expect(getItem().stdout).toBe("kc-pass-43");
    runSecret({ args: ["rm", "kc/test-item", "--force"], cwd: backendDir, env: keychainEnv });
    expect(getItem().exitCode).not.toBe(0);
  });
});
