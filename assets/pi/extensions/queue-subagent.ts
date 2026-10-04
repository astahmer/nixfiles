import type { ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";

const MAX_CAPTURE_BYTES = 1_048_576;

type Completion = {
	status: "completed" | "failed";
	outputSaved: boolean;
};

type WatchOptions = {
	child: ChildProcess;
	outputFile: string;
	onFinished: (completion: Completion) => void;
};

export class QueueSubagent {
	static watch = ({ child, outputFile, onFinished }: WatchOptions): void => {
		const output: Buffer[] = [];
		let capturedBytes = 0;
		let truncated = false;
		let failedToStart = false;

		const capture = (chunk: Buffer, prefix = Buffer.alloc(0)) => {
			const prefixBytes = prefix.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - capturedBytes));
			capturedBytes += prefixBytes.byteLength;
			const chunkBytes = chunk.subarray(0, Math.max(0, MAX_CAPTURE_BYTES - capturedBytes));
			capturedBytes += chunkBytes.byteLength;
			output.push(prefixBytes, chunkBytes);
			if (chunkBytes.byteLength < chunk.byteLength) truncated = true;
		};

		child.stdout?.on("data", (chunk: Buffer) => capture(chunk));
		child.stderr?.on("data", (chunk: Buffer) => capture(chunk, Buffer.from("\n[stderr]\n")));
		child.on("error", () => {
			failedToStart = true;
		});
		child.on("close", async (code) => {
			const tail = truncated ? Buffer.from("\n[output truncated at 1 MiB]\n") : Buffer.alloc(0);
			try {
				await writeFile(outputFile, Buffer.concat([...output, tail]));
			} catch {
				onFinished({ status: "failed", outputSaved: false });
				return;
			}
			onFinished({
				status: !failedToStart && code === 0 ? "completed" : "failed",
				outputSaved: true,
			});
		});
	};
}
