import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, revisionSchema, fileChangeSchema } from "./contract";

const target = z.object({ hostId: z.string().min(1), path: z.string().trim().min(1).max(4096) });
const revisionTarget = target.extend({ revision: z.string().min(1).max(128) });

export const rpcContract = defineRpcContract({
  inspect: { input: target, output: z.object({ root: z.string(), currentRevision: z.string(), revisions: z.array(revisionSchema), changes: z.array(fileChangeSchema), workspaces: z.array(z.object({ name: z.string(), path: z.string(), revision: z.string() })), diff: z.string() }) },
  diff: { input: revisionTarget, output: z.object({ diff: z.string(), files: z.array(z.string()) }) },
  describe: { input: revisionTarget.extend({ description: z.string().max(10000) }), output: z.object({ ok: z.boolean() }) },
  rebase: { input: revisionTarget.extend({ destination: z.string() }), output: z.object({ ok: z.boolean() }) },
  squash: { input: revisionTarget.extend({ destination: z.string() }), output: z.object({ ok: z.boolean() }) },
  split: { input: revisionTarget.extend({ files: z.array(z.string()).min(1).max(100), message: z.string().max(10000) }), output: z.object({ ok: z.boolean() }) },
});

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.log.info("loaded");

  bb.rpc.register(rpcContract, {
      inspect: async (input) => host.call("inspect", { path: input.path }, { hostId: input.hostId }),
      diff: async (input) => host.call("diff", { path: input.path, revision: input.revision }, { hostId: input.hostId }),
      describe: async (input) => host.call("describe", input, { hostId: input.hostId }),
      rebase: async (input) => host.call("rebase", input, { hostId: input.hostId }),
      squash: async (input) => host.call("squash", input, { hostId: input.hostId }),
      split: async (input) => host.call("split", input, { hostId: input.hostId }),
  });
}
