/**
 * User message trail (read-only viewer)
 *
 * /trail   Browse your past messages in the current branch without moving
 *          the session. Searchable preview list -> enter shows the full
 *          message in a scrollable overlay -> esc goes back / closes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, SelectList, Text, truncateToWidth, type SelectItem } from "@earendil-works/pi-tui";

interface BranchEntry {
	type: string;
	id: string;
	timestamp?: number;
	message?: { role: string; timestamp?: number; content: string | Array<{ type: string; text?: string }> };
}

interface TrailItem {
	index: number;
	entryId: string;
	preview: string;
	fullText: string;
	timestamp?: number;
}

const textOf = (entry: BranchEntry): string => {
	const content = entry.message?.content;
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join(" ");
};

const wordWrap = (text: string, width: number): string[] => {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (!paragraph) {
			lines.push("");
			continue;
		}
		let current = "";
		for (const word of paragraph.split(/\s+/)) {
			const candidate = current ? `${current} ${word}` : word;
			if (candidate.length <= width) {
				current = candidate;
			} else {
				if (current) lines.push(current);
				current = word.length > width ? truncateToWidth(word, width) : word;
			}
		}
		lines.push(current);
	}
	return lines;
};

const fmtTime = (ms?: number): string => {
	if (!ms) return "";
	return new Date(ms).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("trail", {
		description: "Browse previous user messages",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			const items: (SelectItem & { trail: TrailItem })[] = ctx.sessionManager
				.getBranch()
				.filter(
					(entry): entry is BranchEntry =>
						entry.type === "message" &&
						(entry as BranchEntry).message?.role === "user" &&
						textOf(entry as BranchEntry).trim().length > 0,
				)
				.map((entry, index) => {
					const fullText = textOf(entry);
					return {
						label: `#${index + 1}  ${truncateToWidth(fullText.replace(/\s+/g, " ").trim(), 90)}`,
						value: entry.id,
						trail: {
							index: index + 1,
							entryId: entry.id,
							preview: fullText,
							fullText,
							timestamp: entry.message?.timestamp ?? entry.timestamp,
						},
					};
				});

			items.reverse();

			if (items.length === 0) {
				ctx.ui.notify("No user messages in this branch yet", "info");
				return;
			}

			let selected: TrailItem | undefined;
			for (;;) {
				selected = await ctx.ui.custom<TrailItem | null>((tui, theme, _kb, done) => {
					const container = new Container();
					container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
					container.addChild(new Text(theme.fg("accent", theme.bold("Your messages")), 1, 0));

					const selectList = new SelectList(items, Math.min(items.length, 15), {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					});
					selectList.onSelect = (item) => done((item as SelectItem & { trail: TrailItem }).trail);
					selectList.onCancel = () => done(null);
					container.addChild(selectList);

					container.addChild(
						new Text(theme.fg("dim", "type to filter • ↑↓ navigate • enter read • esc close"), 1, 0),
					);
					container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

					return {
						render: (width) => container.render(width),
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							selectList.handleInput(data);
							tui.requestRender();
						},
					};
				});
				if (!selected) return;

				const reopened = await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
					const container = new Container();
					container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

					const header = `#${selected.index}  ${fmtTime(selected.timestamp)}`;
					container.addChild(new Text(theme.fg("accent", theme.bold(header)), 1, 0));
					container.addChild(new DynamicBorder((s) => theme.fg("dim", s)));

					let offset = 0;
					let cachedWidth = 0;
					let wrapped: string[] = [];

					const visibleWindow = 20;

					const body = new Text("", 1, 0);
					container.addChild(body);

					const refresh = () => {
						const window_ = wrapped.slice(offset, offset + visibleWindow);
						const more =
							offset + visibleWindow < wrapped.length
								? theme.fg("dim", `  … ${wrapped.length - offset - visibleWindow} more lines`)
								: "";
						body.setText(window_.join("\n") + more);
					};

					return {
						render: (width) => {
							if (width !== cachedWidth) {
								cachedWidth = width;
								wrapped = wordWrap(selected.fullText.trim(), Math.max(width - 4, 20));
								offset = 0;
								refresh();
							}
							return container.render(width);
						},
						invalidate: () => container.invalidate(),
						handleInput: (data) => {
							const maxOffset = Math.max(wrapped.length - visibleWindow, 0);
							if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data.toString() === "q") {
								done(true);
								return;
							}
							if (matchesKey(data, Key.up)) offset = Math.max(offset - 1, 0);
							else if (matchesKey(data, Key.down)) offset = Math.min(offset + 1, maxOffset);
							else if (matchesKey(data, Key.pageUp)) offset = Math.max(offset - visibleWindow, 0);
							else if (matchesKey(data, Key.pageDown)) offset = Math.min(offset + visibleWindow, maxOffset);
							else return;
							refresh();
							tui.requestRender();
						},
					};
				});
				if (!reopened) return;
			}
		},
	});
}
