// Fake `bw serve` for the regression suite: serves the same fake items the
// fake bw CLI returns, over a unix socket, so daemon-mode paths are tested
// with real HTTP. Env: FAKE_DAEMON_ITEMS (JSON array file), FAKE_DAEMON_MISSING
// (file; when present every data request is denied, like a locked vault),
// FAKE_DAEMON_LOG (request log).
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const socket = (process.argv[2] || "").replace(/^unix:\/\//, "");
const itemsFile = process.env.FAKE_DAEMON_ITEMS || "";
const missingFile = process.env.FAKE_DAEMON_MISSING || "";
const logFile = process.env.FAKE_DAEMON_LOG || "";

const log = (line: string): void => {
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // logging is best-effort
  }
};

Bun.serve({
  unix: socket,
  fetch(req) {
    const url = new URL(req.url);
    log(`${req.method} ${url.pathname}`);
    // /status is never gated, exactly like the real bw serve.
    if (url.pathname === "/status") {
      const locked = missingFile && existsSync(missingFile);
      return Response.json({
        success: true,
        data: {
          serverUrl: "https://vault.bitwarden.eu",
          lastSync: "2026-01-15T10:00:00.000Z",
          userEmail: "test@example.com",
          userId: "user-1",
          status: locked ? "locked" : "unlocked",
        },
      });
    }
    if (missingFile && existsSync(missingFile)) {
      return Response.json({ success: false, errorMessage: "Vault is locked." }, { status: 400 });
    }
    if (url.pathname === "/sync" && req.method === "POST") {
      return Response.json({ success: true, data: null });
    }
    if (url.pathname === "/list/object/items") {
      try {
        return Response.json({ success: true, data: JSON.parse(readFileSync(itemsFile, "utf8")) });
      } catch {
        return Response.json({ success: false, errorMessage: "no items file" }, { status: 500 });
      }
    }
    return Response.json({ success: false, errorMessage: "not found" }, { status: 404 });
  },
});
