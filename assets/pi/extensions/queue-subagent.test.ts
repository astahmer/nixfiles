import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { QueueSubagent } from "./queue-subagent";

const runSubagent = async (source: string) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-queue-subagent-test-"));
	const outputFile = join(directory, "output.md");
	try {
		const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "pipe"] });
		const completion = new Promise<{ status: "completed" | "failed"; outputSaved: boolean }>(
			(resolve) => {
				QueueSubagent.watch({ child, outputFile, onFinished: resolve });
			},
		);
		const result = await completion;
		return { ...result, output: await readFile(outputFile, "utf8") };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};

test("captures completed child stdout and reports completion", async () => {
	const result = await runSubagent("process.stdout.write('answer')");
	expect(result.status).toBe("completed");
	expect(result.outputSaved).toBe(true);
	expect(result.output).toBe("answer");
});

test("captures failed child output and bounds the artifact", async () => {
	const result = await runSubagent(
		"process.stderr.write('failed'); process.stdout.write('x'.repeat(2_000_000), () => { process.exitCode = 7 })",
	);
	expect(result.status).toBe("failed");
	expect(result.outputSaved).toBe(true);
	expect(result.output.includes("[stderr]")).toBe(true);
	expect(result.output.includes("failed")).toBe(true);
	expect(result.output.includes("[output truncated at 1 MiB]")).toBe(true);
	expect(Buffer.byteLength(result.output)).toBeLessThan(1_048_576 + 64);
});
