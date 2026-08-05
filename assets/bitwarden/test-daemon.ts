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
  async fetch(req) {
    const url = new URL(req.url);
    log(`${req.method} ${url.pathname}`);
    if (url.pathname === "/object/item" && req.method === "POST") {
      return Response.json({ success: true, data: { type: 1, name: "created", id: "item-new" } });
    }
    if (url.pathname.startsWith("/object/item/") && (req.method === "PUT" || req.method === "DELETE")) {
      return Response.json({ success: true, data: req.method === "PUT" ? { id: "item-1" } : null });
    }
    if (url.pathname === "/generate" && req.method === "GET") {
      return Response.json({ success: true, data: { object: "string", data: "gen-pass-123" } });
    }
    if (url.pathname === "/sync" && req.method === "POST") {
      return Response.json({ success: true, data: null });
    }
    // Mirror the real bw serve response shapes: status is nested under
    // data.template, lists under data.data.
    if (url.pathname === "/status") {
      const locked = missingFile && existsSync(missingFile);
      return Response.json({
        success: true,
        data: {
          object: "template",
          template: {
            serverUrl: "https://vault.bitwarden.eu",
            lastSync: "2026-01-15T10:00:00.000Z",
            userEmail: "test@example.com",
            userId: "user-1",
            status: locked ? "locked" : "unlocked",
          },
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
        return Response.json({
          success: true,
          data: { object: "list", data: JSON.parse(readFileSync(itemsFile, "utf8")) },
        });
      } catch {
        return Response.json({ success: false, errorMessage: "no items file" }, { status: 500 });
      }
    }
    return Response.json({ success: false, errorMessage: "not found" }, { status: 404 });
  },
});
