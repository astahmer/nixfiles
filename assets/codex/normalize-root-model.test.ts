import { expect, test } from "bun:test";

const normalize = (input: string): string => {
  const result = Bun.spawnSync(["awk", "-f", `${import.meta.dir}/normalize-root-model.awk`], {
    stdin: new TextEncoder().encode(input),
  });
  expect(result.exitCode).toBe(0);
  return result.stdout.toString();
};

test("rewrites a routed root model and drops the legacy root catalog, leaving profiles alone", () => {
  expect(
    normalize(`model = "codex-perso/gpt-6-luna"
model_catalog_json = "legacy-root-catalog"

[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
`),
  ).toBe(`model = "gpt-6-luna"


[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
`);
});

test("adds the root model when the config has none", () => {
  expect(
    normalize(`[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
`),
  ).toBe(`model = "gpt-6-luna"
[profiles.deepseek]
model = "deepseek-v4"
model_catalog_json = "profile-catalog"
`);
});
