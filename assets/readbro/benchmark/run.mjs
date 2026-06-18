import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import fixtures from "./fixtures.json" with { type: "json" };
import { SCENARIOS } from "./scenarios.mjs";
import { runScenario, savings } from "./simulate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const NIXFILES_ROOT = resolve(PKG_ROOT, "../..");

function resolveSourceRepo() {
  const candidate = resolve(NIXFILES_ROOT, fixtures.sourceRepo);
  if (!existsSync(candidate)) {
    throw new Error(
      `Missing ${fixtures.sourceRepo}. Clone composto reference first (see reference-repos.md).`,
    );
  }
  return candidate;
}

function prepareWorkdir(sourceRepo) {
  const workDir = mkdtempSync(join(tmpdir(), "readbro-bench-"));
  mkdirSync(join(workDir, ".git"));
  const allFiles = [
    ...new Set([
      ...fixtures.files,
      ...(fixtures.largeFiles ?? []),
      ...(fixtures.markdownFiles ?? []),
    ]),
  ];
  for (const rel of allFiles) {
    const src = join(sourceRepo, rel);
    const dest = join(workDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }
  return workDir;
}

function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function printTable(scenario, results) {
  console.log(`\n### ${scenario.label}`);
  console.log(scenario.detail);
  console.log("");
  const header = ["Strategy", "Billed", "Raw equiv", "Saved %"];
  const widths = [28, 10, 12, 10];
  console.log(header.map((h, i) => pad(h, widths[i])).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of results) {
    const saved = savings(row.billed, row.rawEquivalent);
    console.log(
      [
        pad(row.label, widths[0]),
        pad(row.billed.toLocaleString(), widths[1]),
        pad(row.rawEquivalent.toLocaleString(), widths[2]),
        pad(`${saved.toFixed(1)}%`, widths[3]),
      ].join("  "),
    );
  }
}

function printSummary(allRows) {
  console.log("\n## Summary (avg savings vs raw-equiv per scenario)\n");
  const byLabel = new Map();
  for (const row of allRows) {
    const list = byLabel.get(row.label) ?? [];
    list.push(savings(row.billed, row.rawEquivalent));
    byLabel.set(row.label, list);
  }
  const ranked = [...byLabel.entries()]
    .map(([label, values]) => ({
      label,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
    }))
    .sort((a, b) => b.avg - a.avg);

  for (const { label, avg } of ranked) {
    console.log(`  ${pad(label, 28)} ${avg.toFixed(1)}%`);
  }

  const rbL1 = byLabel.get("readbro (L1)");
  const compL1 = byLabel.get("composto (L1 only)");
  if (rbL1 && compL1) {
    const delta =
      rbL1.reduce((a, b) => a + b, 0) / rbL1.length -
      compL1.reduce((a, b) => a + b, 0) / compL1.length;
    console.log(`\n  readbro (L1) vs composto (L1 only): +${delta.toFixed(1)}pp avg`);
  }
}

function main() {
  const sourceRepo = resolveSourceRepo();
  const workDir = prepareWorkdir(sourceRepo);
  const allRows = [];

  console.log("# readbro benchmark");
  console.log("");
  console.log(`Fixtures: ${fixtures.files.length} proof + ${(fixtures.largeFiles ?? []).length} large + ${(fixtures.markdownFiles ?? []).length} markdown`);
  console.log(`Source: ${sourceRepo}`);
  console.log(`Token estimate: ceil(chars × 0.75) — same as cachebro README`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log(`Run date: ${new Date().toISOString().slice(0, 10)}`);

  (async () => {
    try {
      for (const [index, scenario] of SCENARIOS.entries()) {
        const results = await runScenario(workDir, scenario, `s${index}`);
        printTable(scenario, results);
        allRows.push(...results);
      }
      printSummary(allRows);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  })();
}

main();
