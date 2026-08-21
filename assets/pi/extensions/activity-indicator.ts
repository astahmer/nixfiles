import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TICK_MS = 1_000;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export default function (pi: ExtensionAPI) {
	let ctxRef: ExtensionContext | undefined;
	let active = false;
	let activityLabel = "";
	let lastEventAt = 0;
	let activityStartedAt = 0;
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	let frameIndex = 0;
	let doneAt: string | undefined;

	const formatDuration = (seconds: number): string => {
		if (seconds < 60) return `${seconds}s`;
		const minutes = Math.floor(seconds / 60);
		return `${minutes}m${seconds % 60}s`;
	};

	const render = () => {
		const ctx = ctxRef;
		if (!ctx?.hasUI) return;
		if (!active) {
			ctx.ui.setStatus("activity", doneAt ? `✓ done at ${doneAt}` : undefined);
			return;
		}
		frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
		const now = Date.now();
		const totalSeconds = Math.floor((now - activityStartedAt) / 1_000);
		const silentSeconds = Math.floor((now - lastEventAt) / 1_000);
		const spinner = SPINNER_FRAMES[frameIndex];
		const silentPart = silentSeconds >= 5 ? ` · quiet ${formatDuration(silentSeconds)}` : "";
		ctx.ui.setStatus("activity", `${spinner} ${activityLabel} ${formatDuration(totalSeconds)}${silentPart}`);
	};

	const startTick = () => {
		if (!tickTimer) tickTimer = setInterval(render, TICK_MS);
	};

	const stopTick = () => {
		if (tickTimer) clearInterval(tickTimer);
		tickTimer = undefined;
	};

	const markActivity = (label?: string) => {
		lastEventAt = Date.now();
		if (label && label !== activityLabel) {
			activityLabel = label;
			activityStartedAt = Date.now();
		}
	};

	pi.on("session_start", (_event, ctx) => {
		ctxRef = ctx;
	});

	pi.on("session_shutdown", () => {
		stopTick();
		ctxRef = undefined;
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		ctxRef = ctx;
		active = true;
		doneAt = undefined;
		markActivity("starting");
		startTick();
	});

	pi.on("message_update", async (event) => {
		if (!active) return;
		const streamEvent = event.assistantMessageEvent;
		const isThinking = streamEvent?.type === "thinking_delta" || streamEvent?.type === "thinking_start";
		markActivity(isThinking ? "thinking" : "responding");
	});

	pi.on("tool_execution_start", async (event) => {
		if (!active) return;
		const args = event.args as Record<string, unknown> | undefined;
		const detail =
			event.toolName === "bash" && typeof args?.command === "string"
				? `bash: ${args.command.slice(0, 40)}`
				: event.toolName;
		markActivity(detail);
	});

	pi.on("tool_execution_end", async () => {
		if (!active) return;
		markActivity("processing results");
	});

	pi.on("agent_settled", async () => {
		active = false;
		activityLabel = "";
		stopTick();
		doneAt = new Date().toLocaleTimeString();
		render();
	});
}
