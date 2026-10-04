import { expect, test } from "bun:test";
import { FreeModelRetryPolicy } from "./free-model-retry-policy.ts";

test("free-model automatic retries stop at a bounded attempt count", () => {
  expect(FreeModelRetryPolicy.canSchedule(1)).toBe(true);
  expect(FreeModelRetryPolicy.canSchedule(FreeModelRetryPolicy.maximumAttempts)).toBe(true);
  expect(FreeModelRetryPolicy.canSchedule(0)).toBe(false);
  expect(FreeModelRetryPolicy.canSchedule(FreeModelRetryPolicy.maximumAttempts + 1)).toBe(false);
  expect(FreeModelRetryPolicy.canSchedule(Number.NaN)).toBe(false);
});

test("free-model backoff grows exponentially and stays capped", () => {
  expect([1, 2, 3, 4, 5].map(FreeModelRetryPolicy.delayFor)).toEqual([
    2_000, 4_000, 8_000, 16_000, 30_000,
  ]);
  expect(FreeModelRetryPolicy.delayFor(20)).toBe(30_000);
});
