import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { formatFetchedLayers, formatRepeatPathNotice } from "../src/session-context.ts";

test("formatFetchedLayers groups layers and windows", () => {
  const text = formatFetchedLayers([
    { layer: "L1", readOffset: null, readMaxLines: null, reads: 1 },
    { layer: "L3", readOffset: 139, readMaxLines: 200, reads: 2 },
  ]);
  assert.match(text, /L1 \(full\)/);
  assert.match(text, /L3 \(lines 140–339\)/);
});

test("formatRepeatPathNotice appears from second read onward", () => {
  const notice = formatRepeatPathNotice({
    displayPath: "apps/backend/spec.ts",
    readNumber: 2,
    stats: {
      readCount: 1,
      fetches: [{ layer: "L1", readOffset: null, readMaxLines: null, reads: 1 }],
    },
    layer: "L3",
    window: { offset: 139, maxLines: 30 },
  });
  assert.ok(notice);
  assert.match(notice!, /read #2/);
  assert.match(notice!, /batch other files/);
});
