import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const plannotatorEvents = await import(
	join(homedir(), ".pi", "agent", "npm", "node_modules", "@plannotator", "pi-extension", "plannotator-events.ts")
);
const { PLANNOTATOR_REQUEST_CHANNEL, PLANNOTATOR_REVIEW_RESULT_CHANNEL, PLANNOTATOR_PLAN_APPROVED_CHANNEL } = plannotatorEvents;

type Phase = "idle" | "planning" | "executing";

const PHASE_LABELS: Record<Phase, string> = {
	idle: "○ PLAN MODE OFF",
	planning: "🟡 PLANNING — writes restricted, plan file only",
	executing: "🟢 EXECUTING — plan approved, full tool access",
};

const POLL_INTERVAL_MS = 2_000;

interface PlannotatorBranchEntry {
	type: string;
	customType?: string;
	data?: { phase?: Phase };
}

const sessionHasPlannotatorState = (ctx: ExtensionContext): boolean =>
	ctx.sessionManager
		.getBranch()
		.some((entry: PlannotatorBranchEntry) => entry.type === "custom" && entry.customType === "plannotator");

const shortSessionId = (ctx: ExtensionContext): string => {
	const sessionId = ctx.sessionManager.getSessionId();
	return sessionId ? sessionId.slice(0, 4) : "????";
};

export default async function (pi: ExtensionAPI) {
	let currentPhase: Phase | undefined;
	let pollTimer: ReturnType<typeof setInterval> | undefined;

	const requestPhase = async (): Promise<Phase | undefined> => {
		const response = await new Promise<{ status: string; result?: Phase } | null>((resolve) => {
			pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, {
				requestId: crypto.randomUUID(),
				action: "plan-mode",
				payload: { mode: "status" },
				respond: resolve,
			});
			setTimeout(() => resolve(null), 1_500);
		});
		return response?.status === "handled" ? response.result : undefined;
	};

	const render = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (currentPhase === undefined || currentPhase === "idle" || !sessionOwnsPhase(ctx)) {
			ctx.ui.setWidget("plannotator-phase", undefined);
			ctx.ui.setStatus("plannotator-phase", undefined);
			return;
		}
		const tag = ` [${shortSessionId(ctx)}]`;
		ctx.ui.setWidget("plannotator-phase", [PHASE_LABELS[currentPhase] + tag]);
		ctx.ui.setStatus(
			"plannotator-phase",
			(currentPhase === "planning" ? "🟡 planning" : "🟢 executing") + tag,
		);
	};

	let ownsPhase: boolean | undefined;
	const sessionOwnsPhase = (ctx: ExtensionContext): boolean => {
		if (ownsPhase === undefined) ownsPhase = sessionHasPlannotatorState(ctx);
		return ownsPhase;
	};

	const refresh = async (ctx: ExtensionContext) => {
		if (!sessionOwnsPhase(ctx)) {
			if (currentPhase !== undefined) {
				currentPhase = undefined;
				render(ctx);
			}
			return;
		}
		const phase = await requestPhase();
		if (phase !== undefined && phase !== currentPhase) {
			currentPhase = phase;
			render(ctx);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		ownsPhase = undefined;
		void refresh(ctx);
		if (!pollTimer) {
			pollTimer = setInterval(() => void refresh(ctx), POLL_INTERVAL_MS);
		}
	});

	pi.on("session_shutdown", () => {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
	});

	pi.events.on(PLANNOTATOR_PLAN_APPROVED_CHANNEL, () => {
		currentPhase = "executing";
	});

	pi.events.on(PLANNOTATOR_REVIEW_RESULT_CHANNEL, () => {
		currentPhase = "executing";
	});

	pi.registerCommand("phase", {
		description: "Show current plannotator plan-mode phase",
		handler: async (args, ctx) => {
			await refresh(ctx);
			const label = currentPhase === undefined ? "unknown (plannotator not loaded?)" : PHASE_LABELS[currentPhase];
			ctx.ui.notify(`Phase: ${label}`, "info");
		},
	});
}
