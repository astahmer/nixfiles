import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  doctorExitCode,
  formatDoctor,
  runDoctor,
  type DoctorReport,
} from "../src/doctor.ts";
import { parseDoctorFlags } from "../src/stats-cli.ts";

test("parseDoctorFlags reads --path and --json", () => {
  assert.deepEqual(parseDoctorFlags(["--path", ".", "--json"]), {
    path: ".",
    json: true,
  });
});

test("formatDoctor renders human output with failures", () => {
  const report: DoctorReport = {
    ok: false,
    checks: [
      {
        id: "composto",
        label: "composto",
        status: "fail",
        detail: "not found on PATH",
        fix: "Install composto.",
      },
      {
        id: "repo_root",
        label: "repo root",
        status: "ok",
        detail: "/tmp/repo  (git)",
      },
    ],
  };
  const text = formatDoctor(report);
  assert.match(text, /readbro doctor/);
  assert.match(text, /✗ composto/);
  assert.match(text, /1 check failed/);
  assert.equal(doctorExitCode(report), 1);
});

test("runDoctor checks cache dir in temp git repo", () => {
  const tmp = mkdtempSync(join(tmpdir(), "readbro-doctor-"));
  const repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(repo, ".git"));

  const report = runDoctor({ anchorPath: repo });
  const cacheCheck = report.checks.find((row) => row.id === "cache_dir");
  const repoCheck = report.checks.find((row) => row.id === "repo_root");

  assert.equal(cacheCheck?.status, "ok");
  assert.equal(repoCheck?.status, "ok");
  assert.match(repoCheck?.detail ?? "", /repo/);

  rmSync(tmp, { recursive: true, force: true });
});

test("formatDoctor json output", () => {
  const report: DoctorReport = { ok: true, checks: [] };
  const parsed = JSON.parse(formatDoctor(report, true)) as DoctorReport;
  assert.equal(parsed.ok, true);
  assert.equal(doctorExitCode(report), 0);
});
