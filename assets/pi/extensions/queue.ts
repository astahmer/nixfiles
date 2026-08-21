/**
 * Queue extension
 *
 * Queue user messages while the agent is busy and manage them:
 *
 *   /queue <message>   Enqueue a message (sent immediately if idle)
 *   /queue             Open the queue manager
 *   /queue clear       Drop all queued messages
 *
 * Per-message actions: Send now / Steer / Edit / Delete /
 * Delegate to subagent.
 * Bulk actions: Send all, Steer all, Delegate all, Clear all.
 *
 * In the manager: shift+up / shift+down move the selected item
 * within the queue.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

interface QueuedMessage {
	id: number;
	text: string;
}

export default function (pi: ExtensionAPI) {
	const queue: QueuedMessage[] = [];
	let nextId = 1;
	let delivering = false;
	let outputDir = "";
	const children = new Set<ReturnType<typeof spawn>>();

	const renderWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (queue.length === 0) {
			ctx.ui.setWidget("queue", []);
			return;
		}
		const lines = [`queued: ${queue.length}`];
		for (const item of queue.slice(0, 3)) {
			const preview = item.text.replace(/\s+/g, " ").slice(0, 60);
			lines.push(`  #${item.id} ${preview}${item.text.length > 60 ? "..." : ""}`);
		}
		if (queue.length > 3) lines.push(`  ...and ${queue.length - 3} more`);
		ctx.ui.setWidget("queue", lines);
	};

	const deliverNext = async (ctx: ExtensionContext) => {
		if (delivering || queue.length === 0 || !ctx.isIdle()) return;
		const item = queue.shift()!;
		delivering = true;
		renderWidget(ctx);
		try {
			pi.sendUserMessage(item.text);
			ctx.ui.notify(`Delivered queued #${item.id}`, "info");
		} finally {
			delivering = false;
		}
	};

	const enqueue = async (text: string, ctx: ExtensionContext) => {
		queue.push({ id: nextId++, text });
		renderWidget(ctx);
		ctx.ui.notify(`Queued (${queue.length} pending)`, "info");
	};

	const sendDirect = (text: string, ctx: ExtensionContext) => {
		if (ctx.isIdle()) {
			pi.sendUserMessage(text);
		} else {
			pi.sendUserMessage(text, { deliverAs: "steer" });
			ctx.ui.notify("Steered into current run", "info");
		}
	};

	const delegateToSubagent = async (text: string, ctx: ExtensionContext) => {
		if (!outputDir) outputDir = await mkdtemp(join(tmpdir(), "pi-queue-"));
		const outputFile = join(outputDir, `task-${Date.now()}.md`);
		const child = spawn("pi", ["-p", text], { cwd: ctx.cwd, stdio: "ignore" });
		children.add(child);
		child.on("close", () => {
			children.delete(child);
			ctx.ui.notify(`Subagent finished, output: ${outputFile}`, "info");
		});
		ctx.ui.notify(`Delegated to background pi (pid ${child.pid}), output: ${outputFile}`, "info");
	};

	const removeFromQueue = (id: number, ctx: ExtensionContext) => {
		const index = queue.findIndex((item) => item.id === id);
		if (index !== -1) queue.splice(index, 1);
		renderWidget(ctx);
	};

	const openManager = async (ctx: ExtensionContext) => {
		if (queue.length === 0) {
			ctx.ui.notify("Queue is empty. Usage: /queue <message>", "info");
			return;
		}

		let selectedIndex = 0;
		const rowCount = queue.length + 1;

		type ManagerResult = { action: "manageAll" } | { action: "manage"; item: QueuedMessage } | null;
		const result = await ctx.ui.custom<ManagerResult>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
			const list = new Text("", 0, 0);
			container.addChild(list);
			container.addChild(new Text(theme.fg("dim", "↑↓ select · shift+↑/↓ move · enter actions · esc close"), 1, 0));
			container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

			const renderList = () => {
				const rows = [theme.fg("accent", theme.bold(`Queue (${queue.length})`)), ""];
				rows.push(truncateToWidth(`${selectedIndex === 0 ? "> " : "  "}${theme.fg("accent", "(all messages)")}`, 100));
				queue.forEach((item, i) => {
					const selected = i + 1 === selectedIndex;
					const label = `#${item.id} ${item.text.replace(/\s+/g, " ").slice(0, 70)}`;
					const styled = selected ? theme.fg("accent", label) : label;
					rows.push(truncateToWidth(`${selected ? "> " : "  "}${styled}`, 100));
				});
				list.setText(rows.join("\n"));
			};
			renderList();

			const move = (from: number, to: number) => {
				if (to < 0 || to >= queue.length) return;
				const [moved] = queue.splice(from, 1);
				queue.splice(to, 0, moved!);
				renderWidget(ctx);
				tui.requestRender();
			};

			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					if (matchesKey(data, Key.up) && selectedIndex > 0) {
						selectedIndex--;
					} else if (matchesKey(data, Key.down) && selectedIndex < rowCount - 1) {
						selectedIndex++;
					} else if (matchesKey(data, Key.shift("up"))) {
						if (selectedIndex > 1) {
							move(selectedIndex - 2, selectedIndex - 1);
							selectedIndex--;
						}
					} else if (matchesKey(data, Key.shift("down"))) {
						if (selectedIndex >= 1 && selectedIndex < rowCount - 1) {
							move(selectedIndex - 1, selectedIndex);
							selectedIndex++;
						}
					} else if (matchesKey(data, Key.enter)) {
						done(
							selectedIndex === 0
								? { action: "manageAll" }
								: { action: "manage", item: queue[selectedIndex - 1]! },
						);
						return;
					} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
						done(null);
						return;
					} else {
						return;
					}
					renderList();
					tui.requestRender();
				},
			};
		});

		if (!result) return;
		if (result.action === "manageAll") {
			await manageAll(ctx);
			return;
		}
		await manageMessage(result.item, ctx);
	};

	const manageMessage = async (item: QueuedMessage, ctx: ExtensionContext) => {
		const idle = ctx.isIdle();
		const actions = [
			idle ? "Send now" : "Steer (interrupt current run)",
			"Edit",
			"Delegate to subagent",
			"Delete",
		];
		const action = await ctx.ui.select(`#${item.id} ${item.text.slice(0, 80)}`, actions);
		switch (action) {
			case "Send now":
			case "Steer (interrupt current run)":
				removeFromQueue(item.id, ctx);
				sendDirect(item.text, ctx);
				break;
			case "Edit": {
				const edited = await ctx.ui.editor(`Edit #${item.id}`, item.text);
				if (edited !== undefined && edited.trim() && edited !== item.text) {
					item.text = edited.trim();
					renderWidget(ctx);
					ctx.ui.notify(`Updated #${item.id}`, "info");
				}
				break;
			}
			case "Delegate to subagent":
				removeFromQueue(item.id, ctx);
				await delegateToSubagent(item.text, ctx);
				break;
			case "Delete":
				removeFromQueue(item.id, ctx);
				ctx.ui.notify(`Deleted #${item.id}`, "info");
				break;
		}
	};

	const manageAll = async (ctx: ExtensionContext) => {
		const action = await ctx.ui.select(
			`${queue.length} queued messages`,
			["Send all", "Steer all", "Delegate all to subagents", "Clear all"],
		);
		const texts = queue.map((item) => item.text);
		switch (action) {
			case "Send all":
				queue.length = 0;
				renderWidget(ctx);
				for (const text of texts) pi.sendUserMessage(text, { deliverAs: "followUp" });
				break;
			case "Steer all":
				queue.length = 0;
				renderWidget(ctx);
				for (const text of texts) pi.sendUserMessage(text, { deliverAs: "steer" });
				break;
			case "Delegate all to subagents":
				queue.length = 0;
				renderWidget(ctx);
				for (const text of texts) await delegateToSubagent(text, ctx);
				break;
			case "Clear all":
				queue.length = 0;
				renderWidget(ctx);
				ctx.ui.notify("Queue cleared", "info");
				break;
		}
	};

	pi.registerCommand("queue", {
		description: "Queue messages for the agent (/queue <msg>, or no args to manage)",
		handler: async (args, ctx) => {
			const text = args.trim();

			if (!text) {
				await openManager(ctx);
				return;
			}

			if (text === "clear") {
				queue.length = 0;
				renderWidget(ctx);
				ctx.ui.notify("Queue cleared", "info");
				return;
			}

			await enqueue(text, ctx);
			await deliverNext(ctx);
		},
	});

	pi.on("input", async (event, ctx) => {
		if (event.streamingBehavior !== "followUp") return { action: "continue" };
		if (!event.text.trim()) return { action: "continue" };
		await enqueue(event.text, ctx);
		return { action: "handled" };
	});

	pi.registerShortcut("ctrl+q", {
		description: "Open queue manager",
		handler: async (ctx) => {
			await openManager(ctx);
		},
	});

	pi.on("agent_settled", async (_event, ctx) => {
		await deliverNext(ctx);
	});

	pi.on("session_start", async (_event, ctx) => {
		queue.length = 0;
		nextId = 1;
		outputDir = "";
		for (const child of children) child.kill();
		children.clear();
		renderWidget(ctx);
	});

	pi.on("session_shutdown", async () => {
		for (const child of children) child.kill();
		children.clear();
	});
}
