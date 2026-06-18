import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IrCacheStore } from "../src/cache.ts";
import { runCompostoCli, runCompostoCliAll } from "../src/composto.ts";
import { estimateTokens, generatePayload } from "../src/ir.ts";
import { LAYERS, PROOF_FILES } from "./scenarios.mjs";
import { RawCacheStore } from "./raw-cache.mjs";

function payloadTokens(result) {
  if (result.cached && result.linesChanged === 0) {
    return estimateTokens(result.content);
  }
  if (result.cached && result.diff) {
    return estimateTokens(result.diff);
  }
  return estimateTokens(result.content);
}

function applyEdit(workDir, step) {
  const path = resolve(workDir, step.file);
  writeFileSync(path, readFileSync(path, "utf-8") + step.append);
}

function rawEquivalentForFile(abs, layer = "L3") {
  const raw = generatePayload(abs, layer === "L3" ? "L3" : "L3");
  return estimateTokens(raw.payload);
}

function readLayer(step, defaultLayer) {
  return step.layer ?? defaultLayer;
}

function runSymbolStep(workDir, step) {
  const budget = step.budget ?? 4000;
  if (step.type === "symbol_multi") {
    return runCompostoCliAll(
      step.targets.map((target) => ({
        args: ["context", ".", `--budget=${budget}`, `--target=${target}`],
        startPath: workDir,
      })),
    ).then((parts) =>
      step.targets.map((target, index) => `=== ${target} ===\n${parts[index] ?? ""}`).join("\n\n"),
    );
  }
  return Promise.resolve(
    runCompostoCli(["context", ".", `--budget=${budget}`, `--target=${step.target}`], workDir),
  );
}

function processReadSteps(workDir, steps, layer, onRead) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      applyEdit(workDir, step);
      continue;
    }
    if (step.type === "read_batch") {
      const stepLayer = readLayer(step, layer);
      for (const file of step.files) {
        const abs = resolve(workDir, file);
        rawEquivalent += rawEquivalentForFile(abs);
        billed += onRead(abs, stepLayer);
      }
      continue;
    }
    if (step.type === "read") {
      const abs = resolve(workDir, step.file);
      const stepLayer = readLayer(step, layer);
      rawEquivalent += rawEquivalentForFile(abs);
      billed += onRead(abs, stepLayer);
    }
  }
  return { billed, rawEquivalent };
}

export function simulateRaw(workDir, steps) {
  const result = processReadSteps(workDir, steps, "L3", (abs) =>
    estimateTokens(generatePayload(abs, "L3").payload),
  );
  return { ...result, label: "raw (baseline)" };
}

export function simulateCachebro(workDir, steps, dbPath, sessionId) {
  const cache = new RawCacheStore(dbPath, sessionId);
  const result = processReadSteps(workDir, steps, "L3", (abs) => cache.readFile(abs).billed);
  return { ...result, label: "cachebro (raw cache)" };
}

export function simulateComposto(workDir, steps, layer) {
  const result = processReadSteps(workDir, steps, layer, (abs, stepLayer) =>
    estimateTokens(generatePayload(abs, stepLayer).payload),
  );
  return { ...result, label: `composto (${layer} only)` };
}

export function simulateReadbro(workDir, steps, layer, dbPath) {
  const cache = new IrCacheStore(dbPath);
  const result = processReadSteps(workDir, steps, layer, (abs, stepLayer) => {
    const readResult = cache.readFile(abs, { layer: stepLayer });
    return payloadTokens(readResult);
  });
  return { ...result, label: `readbro (${layer})` };
}

export function simulateCompostoMixed(workDir, steps) {
  const result = processReadSteps(workDir, steps, "L1", (abs, stepLayer) =>
    estimateTokens(generatePayload(abs, stepLayer).payload),
  );
  return { ...result, label: "composto (per-step layers)" };
}

export function simulateReadbroMixed(workDir, steps, dbPath) {
  const cache = new IrCacheStore(dbPath);
  const result = processReadSteps(workDir, steps, "L1", (abs, stepLayer) => {
    const readResult = cache.readFile(abs, { layer: stepLayer });
    return payloadTokens(readResult);
  });
  return { ...result, label: "readbro (per-step layers)" };
}

export async function simulateSymbolNaiveReads(workDir) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const file of PROOF_FILES) {
    const abs = resolve(workDir, file);
    rawEquivalent += rawEquivalentForFile(abs);
    billed += estimateTokens(generatePayload(abs, "L1").payload);
  }
  return { billed, rawEquivalent, label: "naive L1 reads (4 proof files)" };
}

export async function simulateSymbolSearch(workDir, steps) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const file of PROOF_FILES) {
    rawEquivalent += rawEquivalentForFile(resolve(workDir, file));
  }
  for (const step of steps) {
    const output = await runSymbolStep(workDir, step);
    billed += estimateTokens(output);
  }
  return { billed, rawEquivalent, label: "composto context (symbol)" };
}

export function simulateMdRaw(workDir, steps) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      applyEdit(workDir, step);
      continue;
    }
    const abs = resolve(workDir, step.file);
    rawEquivalent += rawEquivalentForFile(abs);
    billed += estimateTokens(generatePayload(abs, "L3").payload);
  }
  return { billed, rawEquivalent, label: "raw README" };
}

export function simulateMdIr(workDir, steps, layer, dbPath) {
  const cache = new IrCacheStore(dbPath);
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      applyEdit(workDir, step);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const stepLayer = readLayer(step, layer);
    rawEquivalent += rawEquivalentForFile(abs);
    const result = cache.readFile(abs, { layer: stepLayer });
    billed += payloadTokens(result);
  }
  return { ...{ billed, rawEquivalent }, label: `readbro md-ir (${layer})` };
}

export function savings(billed, rawEquivalent) {
  if (rawEquivalent === 0) return 0;
  return ((rawEquivalent - billed) / rawEquivalent) * 100;
}

export function runScenario(workDir, scenario, runId) {
  const files = scenario.files ?? PROOF_FILES;
  const steps = scenario.steps(files);

  if (scenario.symbolOnly) {
    return Promise.all([
      simulateSymbolNaiveReads(workDir),
      simulateSymbolSearch(workDir, steps),
    ]);
  }

  if (scenario.markdownOnly) {
    if (scenario.perStepLayers) {
      return [
        () => simulateMdRaw(workDir, steps),
        () => simulateMdIr(workDir, steps, "L0", join(workDir, `.bench-${runId}-md-l0.db`)),
        () => simulateMdIr(workDir, steps, "L1", join(workDir, `.bench-${runId}-md-l1.db`)),
      ].map((fn) => fn());
    }
    return [
      () => simulateMdRaw(workDir, steps),
      () => simulateMdIr(workDir, steps, "L1", join(workDir, `.bench-${runId}-md.db`)),
    ].map((fn) => fn());
  }

  if (scenario.perStepLayers) {
    return [
      () => simulateRaw(workDir, steps),
      () => simulateCachebro(workDir, steps, join(workDir, `.bench-${runId}-raw.db`), `cb-${runId}`),
      () => simulateCompostoMixed(workDir, steps),
      () => simulateReadbroMixed(workDir, steps, join(workDir, `.bench-${runId}-ir-mixed.db`)),
    ].map((fn) => fn());
  }

  const strategies = [
    () => simulateRaw(workDir, steps),
    () => simulateCachebro(workDir, steps, join(workDir, `.bench-${runId}-raw.db`), `cb-${runId}`),
    ...LAYERS.flatMap((layer) => [
      () => simulateComposto(workDir, steps, layer),
      () =>
        simulateReadbro(workDir, steps, layer, join(workDir, `.bench-${runId}-ir-${layer}.db`)),
    ]),
  ];

  return strategies.map((fn) => fn());
}
