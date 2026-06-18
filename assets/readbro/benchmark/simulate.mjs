import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IrCacheStore } from "../src/cache.ts";
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

export function simulateRaw(workDir, steps) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const { payload } = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(payload);
    billed += estimateTokens(payload);
  }
  return { billed, rawEquivalent, label: "raw (baseline)" };
}

export function simulateCachebro(workDir, steps, dbPath, sessionId) {
  const cache = new RawCacheStore(dbPath, sessionId);
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const { payload } = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(payload);
    const result = cache.readFile(abs);
    billed += result.billed;
  }
  return { billed, rawEquivalent, label: "cachebro (raw cache)" };
}

function readLayer(step, defaultLayer) {
  return step.layer ?? defaultLayer;
}

export function simulateComposto(workDir, steps, layer) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const raw = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(raw.payload);
    const stepLayer = readLayer(step, layer);
    const { payload } = generatePayload(abs, stepLayer);
    billed += estimateTokens(payload);
  }
  return { billed, rawEquivalent, label: `composto (${layer} only)` };
}

export function simulateReadbro(workDir, steps, layer, dbPath) {
  const cache = new IrCacheStore(dbPath);
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const raw = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(raw.payload);
    const stepLayer = readLayer(step, layer);
    const result = cache.readFile(abs, { layer: stepLayer });
    billed += payloadTokens(result);
  }
  return { billed, rawEquivalent, label: `readbro (${layer})` };
}

export function simulateCompostoMixed(workDir, steps) {
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const raw = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(raw.payload);
    const { payload } = generatePayload(abs, step.layer);
    billed += estimateTokens(payload);
  }
  return { billed, rawEquivalent, label: "composto (per-step layers)" };
}

export function simulateReadbroMixed(workDir, steps, dbPath) {
  const cache = new IrCacheStore(dbPath);
  let billed = 0;
  let rawEquivalent = 0;
  for (const step of steps) {
    if (step.type === "edit") {
      const path = resolve(workDir, step.file);
      writeFileSync(path, readFileSync(path, "utf-8") + step.append);
      continue;
    }
    const abs = resolve(workDir, step.file);
    const raw = generatePayload(abs, "L3");
    rawEquivalent += estimateTokens(raw.payload);
    const result = cache.readFile(abs, { layer: step.layer });
    billed += payloadTokens(result);
  }
  return { billed, rawEquivalent, label: "readbro (per-step layers)" };
}

export function savings(billed, rawEquivalent) {
  if (rawEquivalent === 0) return 0;
  return ((rawEquivalent - billed) / rawEquivalent) * 100;
}

export function runScenario(workDir, scenario, runId) {
  const files = scenario.files ?? PROOF_FILES;
  const steps = scenario.steps(files);

  if (scenario.perStepLayers) {
    return [
      () => simulateRaw(workDir, steps),
      () => simulateCachebro(workDir, steps, join(workDir, `.bench-${runId}-raw.db`), `cb-${runId}`),
      () => simulateCompostoMixed(workDir, steps),
      () =>
        simulateReadbroMixed(workDir, steps, join(workDir, `.bench-${runId}-ir-mixed.db`)),
    ].map((fn) => fn());
  }

  const strategies = [
    () => simulateRaw(workDir, steps),
    () => simulateCachebro(workDir, steps, join(workDir, `.bench-${runId}-raw.db`), `cb-${runId}`),
    ...LAYERS.flatMap((layer) => [
      () => simulateComposto(workDir, steps, layer),
      () =>
        simulateReadbro(
          workDir,
          steps,
          layer,
          join(workDir, `.bench-${runId}-ir-${layer}.db`),
        ),
    ]),
  ];

  return strategies.map((fn) => fn());
}
