/**
 * /btw — throwaway sidechat, zero impact on the main session.
 *
 * Usage:
 *   /btw <question>          ask with fresh context
 *   /btw -c <question>       ask with recent main-session transcript as context
 *
 * The question is answered via a one-off modelRegistry.complete() call with its
 * own session id and no cache retention. Nothing is appended to the session
 * file, the model context, or the transcript. The answer shows in an overlay;
 * Escape dismisses it.
 */

import type { UserMessage } from "@earendil-works/pi-ai";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, getMarkdownTheme, serializeConversation } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";

const SYSTEM_PROMPT = `You are a side-channel assistant answering a quick "btw" question.
The user is mid-task elsewhere, so keep the answer short and direct: lead with the answer, add at most a few sentences of nuance. No preamble, no restating the question.`;

const CONTEXT_MESSAGE_LIMIT = 12;
const CONTEXT_CHAR_LIMIT = 12_000;

const parseArgs = (args: string): { includeSessionContext: boolean; question: string } => {
	const trimmed = args.trim();
	if (trimmed.startsWith("-c ") || trimmed.startsWith("--context ")) {
		return { includeSessionContext: true, question: trimmed.slice(trimmed.indexOf(" ") + 1).trim() };
	}
	return { includeSessionContext: false, question: trimmed };
};

const buildSessionContext = (contextText: string): string =>
	`<recent_session_transcript>
${contextText}
</recent_session_transcript>

Answer the question below using this transcript only where relevant.`;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("btw", {
		description: 'Quick side question in a throwaway context ("/btw -c <question>" includes recent session)',
		handler: async (args, ctx) => {
			const { includeSessionContext, question } = parseArgs(args);
			if (!question) {
				ctx.ui.notify("Usage: /btw [-c] <question>", "info");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("/btw requires a selected model", "error");
				return;
			}

			let contextBlock: string | undefined;
			if (includeSessionContext) {
				const branch = ctx.sessionManager.getBranch();
				const recentMessages = branch
					.filter((entry) => entry.type === "message")
					.slice(-CONTEXT_MESSAGE_LIMIT)
					.map((entry) => entry.message);
				contextBlock = buildSessionContext(
					serializeConversation(convertToLlm(recentMessages)).slice(-CONTEXT_CHAR_LIMIT),
				);
			}

			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: question }],
				timestamp: Date.now(),
			};

			const answer = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `btw: ${truncateToWidth(question, 56, "")}…`);
				loader.onAbort = () => done(null);

				ctx.modelRegistry
					.complete(
						ctx.model,
						{ systemPrompt: SYSTEM_PROMPT, messages: contextBlock ? [{ role: "user", content: [{ type: "text", text: `${contextBlock}\n\n${question}` }], timestamp: userMessage.timestamp }] : [userMessage] },
						{ signal: loader.signal, maxTokens: 8192, cacheRetention: "none", sessionId: uuidv7(), reasoning: ctx.thinkingLevel, reasoningEffort: ctx.thinkingLevel },
					)
					.then((response) => {
						if (response.stopReason === "aborted") return done(null);
						done(
							response.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("\n"),
						);
					})
					.catch((error) => {
						ctx.ui.notify(`btw failed: ${error instanceof Error ? error.message : String(error)}`, "error");
						done(null);
					});

				return loader;
			});

			if (answer === null) return;

			await ctx.ui.custom((_tui, _theme, _kb, done) => {
				const container = new Container();
				container.addChild(new Text(`btw · ${truncateToWidth(question, 72, "")}`, 0, 1));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Markdown(answer, 0, 0, getMarkdownTheme()));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text("esc / q — close", 0, 1));

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						if (matchesKey(data, "escape") || matchesKey(data, "enter") || data === "q") done(undefined);
					},
				};
			}, { overlay: true });
		},
	});
}
