/**
 * Free-model relentless retry
 *
 * Free-tier endpoints (e.g. opencode-go / ox-alpha-free) fail constantly with
 * "Upstream request failed: Endpoint is unavailable". Pi's built-in agent-level
 * retry gives up after `retry.maxRetries` (default 3, 2/4/8s backoff) and the
 * run dies with an error message while the task is half-done.
 *
 * This extension takes over where the built-in retry stops:
 *   - Detects the final error assistant message (stopReason "error").
 *   - Waits with exponential backoff and stops after five automatic retries.
 *   - Re-triggers the turn with a rotating steering prompt ("finish what you
 *     started", "are you done? if not keep going", ...) until a turn completes
 *     without an error.
 *   - Any successful assistant message resets the attempt counter and clears
 *     the status/widget. User input cancels a pending retry (you take over).
 *
 * Only active for free models: provider "opencode-go" + model id matching
 * "-free" by default. Override with PI_FREE_RETRY_MODELS (comma-separated
 * provider/model globs, e.g. "opencode-go/*-free,siliconflow/qwen*") or set
 * PI_FREE_RETRY_MODELS=0 to disable entirely.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FreeModelRetryPolicy } from "./free-model-retry-policy.ts";

const DEFAULT_PATTERN = "opencode-go/*-free*";

const STEERING_PROMPTS = [
  "finish what you started",
  "are you done? if not keep going",
  "continue from exactly where you left off",
  "you were interrupted by an API error — resume the task",
  "keep going until the task is complete",
];

function patterns(): string[] {
  const raw = process.env.PI_FREE_RETRY_MODELS;
  if (!raw) return [DEFAULT_PATTERN];
  if (raw === "0" || raw.toLowerCase() === "off") return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Wildcard match against "provider/modelId". */
function matches(pattern: string, provider: string, modelId: string): boolean {
  if (pattern.includes("/")) {
    const slash = pattern.indexOf("/");
    return glob(pattern.slice(0, slash), provider) && glob(pattern.slice(slash + 1), modelId);
  }
  return glob(pattern, modelId);
}

function glob(pattern: string, value: string): boolean {
  const re = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`,
  );
  return re.test(value);
}

interface RetryState {
  consecutiveErrors: number;
  retryAttempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  countdown: ReturnType<typeof setInterval> | null;
  fireAt: number;
}

export default function (pi: ExtensionAPI) {
  const state: RetryState = {
    consecutiveErrors: 0,
    retryAttempts: 0,
    timer: null,
    countdown: null,
    fireAt: 0,
  };

  const enabledFor = (model?: { provider?: string; modelId?: string } | null) => {
    const pats = patterns();
    if (pats.length === 0 || !model?.provider || !model?.modelId) return false;
    return pats.some((p) => matches(p, model.provider!, model.modelId!));
  };

  const clearTimers = () => {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.countdown !== null) {
      clearInterval(state.countdown);
      state.countdown = null;
    }
  };

  const clearStatus = (ui?: any) => {
    clearTimers();
    state.fireAt = 0;
    if (!ui) return;
    ui.setWidget("free-retry", undefined);
    ui.setStatus("free-retry", undefined);
  };

  const scheduleRetry = (ctx: any) => {
    const ui = ctx.ui as any;
    clearTimers();
    const attempt = state.retryAttempts + 1;
    if (!FreeModelRetryPolicy.canSchedule(attempt)) {
      state.fireAt = 0;
      ui.setWidget("free-retry", undefined);
      ui.setStatus(
        "free-retry",
        `automatic retry limit reached (${FreeModelRetryPolicy.maximumAttempts})`,
      );
      return;
    }
    const delay = FreeModelRetryPolicy.delayFor(attempt);
    state.fireAt = Date.now() + delay;

    const render = () => {
      const remaining = Math.max(0, Math.ceil((state.fireAt - Date.now()) / 1000));
      ui.setWidget("free-retry", [
        `↻ free-model retry #${attempt} in ${remaining}s (endpoint unavailable — will steer when it recovers)`,
      ]);
    };
    render();
    state.countdown = setInterval(render, 1_000);

    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.countdown !== null) {
        clearInterval(state.countdown);
        state.countdown = null;
      }
      if (!enabledFor(ctx.model as any)) {
        state.consecutiveErrors = 0;
        state.retryAttempts = 0;
        clearStatus(ui);
        return;
      }
      if (!ctx.isIdle()) return;
      const prompt = STEERING_PROMPTS[(attempt - 1) % STEERING_PROMPTS.length];
      state.retryAttempts = attempt;
      ui.setStatus("free-retry", `retry #${attempt}: "${prompt}"`);
      pi.sendUserMessage(prompt);
    }, delay);
    state.timer.unref?.();
  };

  pi.on("message_end", async (event, ctx) => {
    const msg = event.message as {
      role: string;
      stopReason?: string;
      errorMessage?: string;
    };
    if (msg.role !== "assistant") return;
    if (!enabledFor(ctx.model as any)) {
      state.consecutiveErrors = 0;
      state.retryAttempts = 0;
      clearStatus(ctx.ui as any);
      return;
    }

    if (msg.stopReason === "error") {
      state.consecutiveErrors += 1;
      const snippet = String(msg.errorMessage ?? "unknown error").slice(0, 120);
      ctx.ui.setStatus("free-retry", `API error #${state.consecutiveErrors}: ${snippet}`);
    } else if (state.consecutiveErrors > 0) {
      // A real response landed — endpoint recovered, clean slate.
      state.consecutiveErrors = 0;
      state.retryAttempts = 0;
      clearStatus(ctx.ui as any);
    }
  });

  // The run has fully ended (built-in retries exhausted, no auto-continuation
  // left). If it ended on an error, start our own backoff countdown.
  pi.on("agent_settled", async (_event, ctx) => {
    if (!enabledFor(ctx.model as any)) {
      state.consecutiveErrors = 0;
      state.retryAttempts = 0;
      clearStatus(ctx.ui as any);
      return;
    }
    if (ctx.isIdle() && state.consecutiveErrors > 0 && state.timer === null) {
      scheduleRetry(ctx);
    } else if (ctx.isIdle() && state.consecutiveErrors === 0) {
      clearStatus(ctx.ui as any);
    }
  });

  // User activity cancels the retry cycle so later sessions start clean.
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    const hasPendingRetry = state.timer !== null || state.countdown !== null;
    if (hasPendingRetry || state.consecutiveErrors > 0) {
      const ui = ctx.ui as any;
      clearStatus(ui);
      state.consecutiveErrors = 0;
      state.retryAttempts = 0;
      if (hasPendingRetry) ui.setStatus("free-retry", "auto-retry cancelled (user input)");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearTimers();
  });
}
