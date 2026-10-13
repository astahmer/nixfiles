import { expect, test } from "bun:test";

const strip = (input: string): string => {
  const result = Bun.spawnSync(["awk", "-f", `${import.meta.dir}/strip-legacy-base-url.awk`], {
    stdin: new TextEncoder().encode(input),
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
};

test("strips only the unmarked root proxy URL and keeps provider tables", () => {
  const output = strip(`openai_base_url = "http://127.0.0.1:10100/v1"
[model_providers.custom]
openai_base_url = "http://127.0.0.1:10100/v1"
[model_providers.injected]
# Auto-injected by opencodex
openai_base_url = "http://127.0.0.1:10100/v1"
`);
  expect(output.match(/^openai_base_url/gm)).toHaveLength(2);
  expect(output).toMatch(/^\[model_providers\.custom\]$/m);
  expect(output).toMatch(/^\[model_providers\.injected\]$/m);
});

test("keeps a root URL that opencodex marked as injected", () => {
  const marked = `# Auto-injected by opencodex
openai_base_url = "http://127.0.0.1:10100/v1"
`;
  expect(strip(marked)).toBe(marked);
});
