/**
 * Herdr tab naming
 *
 * Names the current Herdr tab after the active pi session:
 * session name (from /name or --name) > first user prompt > cwd + session id.
 * No-ops outside Herdr (no HERDR_TAB_ID in the environment).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";

const MAX_LABEL_LENGTH = 40;

export default function (pi: ExtensionAPI) {
	const tabId = process.env.HERDR_TAB_ID;
	if (!tabId || !process.env.HERDR_SOCKET_PATH) return;

	let namedFromPrompt = false;

	const renameTab = async (label: string) => {
		if (!label) return;
		await pi.exec("herdr", ["tab", "rename", tabId, label], { timeout: 3000 });
	};

	const sessionLabel = (ctx: ExtensionContext): string | undefined => {
		const name = ctx.sessionManager.getSessionName();
		if (name) return name;
		for (const entry of ctx.sessionManager.getBranch()) {
			const message = (entry as { message?: { role?: string; content?: unknown } }).message;
			if (message?.role !== "user") continue;
			const content = message.content;
			const text =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content
								.filter((block): block is { type: "text"; text: string } => (block as { type?: string }).type === "text")
								.map((block) => block.text)
								.join(" ")
						: "";
			if (!text.trim()) continue;
			return text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH);
		}
		const sessionId = ctx.sessionManager.getSessionId();
		return `${basename(ctx.cwd)}${sessionId ? ` ${sessionId.slice(0, 8)}` : ""}`;
	};

	const syncTabName = async (ctx: ExtensionContext) => {
		try {
			await renameTab(sessionLabel(ctx) ?? "pi");
		} catch {
			ctx.ui.notify("Failed to rename Herdr tab", "warning");
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		namedFromPrompt = false;
		await syncTabName(ctx);
	});

	pi.on("session_info_changed", async (event, ctx) => {
		if (event.name) {
			namedFromPrompt = true;
			await renameTab(event.name);
		}
	});

	pi.on("input", async (event, ctx) => {
		if (namedFromPrompt || ctx.sessionManager.getSessionName()) return { action: "continue" };
		if (!event.text.trim() || event.text.startsWith("/")) return { action: "continue" };
		namedFromPrompt = true;
		await renameTab(event.text.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL_LENGTH));
		return { action: "continue" };
	});
}
