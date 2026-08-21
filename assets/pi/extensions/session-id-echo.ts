export default function (pi: any) {
	pi.on("session_shutdown", async (event: any, ctx: any) => {
		if (event.reason !== "quit") return
		const sessionFile: string | undefined = ctx.sessionManager?.getSessionFile()
		if (!sessionFile) return
		const sessionId = sessionFile.split("/").pop()!.replace(/\.jsonl$/, "").split("_").pop()!
		process.stderr.write(`\nsession: ${sessionId}\nfile: ${sessionFile}\n`)
	})
}
