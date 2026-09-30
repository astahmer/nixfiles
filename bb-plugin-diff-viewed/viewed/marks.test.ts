import { describe, expect, it } from "vitest";
import {
  fingerprintFromCounts,
  fingerprintFromStats,
  labelForEntry,
  reviewProgress,
  isViewed,
  pathFromToggleLabel,
  prune,
  recordKey,
  threadIdFromPath,
  withMark,
  type DiffFileEntry,
} from "./marks";

describe("threadIdFromPath", () => {
  it("resolves both thread routes to the same id", () => {
    expect(threadIdFromPath("/threads/thr_abc123")).toBe("thr_abc123");
    expect(threadIdFromPath("/projects/proj_x/threads/thr_abc123")).toBe(
      "thr_abc123",
    );
  });

  it("ignores the route remainder, so a panel tab is still the same thread", () => {
    expect(threadIdFromPath("/threads/thr_abc123/changes")).toBe("thr_abc123");
  });

  it("returns null off a thread route", () => {
    expect(threadIdFromPath("/projects/proj_x")).toBeNull();
    expect(threadIdFromPath("/threads/")).toBeNull();
  });
});

describe("pathFromToggleLabel", () => {
  it("reads the path out of either collapse label", () => {
    expect(pathFromToggleLabel("Collapse client/app/_layout.tsx")).toBe(
      "client/app/_layout.tsx",
    );
    expect(pathFromToggleLabel("Expand client/app/_layout.tsx")).toBe(
      "client/app/_layout.tsx",
    );
  });

  it("keeps a rename label intact as one key", () => {
    expect(pathFromToggleLabel("Collapse old/a.ts -> new/a.ts")).toBe(
      "old/a.ts -> new/a.ts",
    );
  });

  it("rejects a card with nothing to expand", () => {
    expect(
      pathFromToggleLabel("client/util/README.md has no changes to expand"),
    ).toBeNull();
    expect(pathFromToggleLabel(null)).toBeNull();
  });
});

describe("fingerprintFromStats", () => {
  it("captures both counts", () => {
    expect(fingerprintFromStats("+105 -120")).toBe("+105 -120");
  });

  it("fills in the zero count a pure add or delete leaves out", () => {
    expect(fingerprintFromStats("+19")).toBe("+19 -0");
    expect(fingerprintFromStats("-19")).toBe("+0 -19");
  });

  it("reads counts bb groups with commas", () => {
    expect(fingerprintFromStats("+1,234 -5")).toBe("+1234 -5");
    expect(fingerprintFromStats("+1,234 -5")).not.toBe(
      fingerprintFromStats("+1,999 -5"),
    );
  });

  it("matches the fingerprint bb's file list produces", () => {
    expect(fingerprintFromStats("+1,234 -0")).toBe(
      fingerprintFromCounts({ additions: 1234, deletions: 0 }),
    );
  });

  it("distinguishes a changed diff from the one that was reviewed", () => {
    expect(fingerprintFromStats("+8 -4")).not.toBe(fingerprintFromStats("+9 -4"));
  });

  it("degrades to a stable value when the header shows no counts", () => {
    expect(fingerprintFromStats("")).toBe("none");
  });
});

describe("withMark", () => {
  const target = { path: "src/a.ts", fingerprint: "+8 -4" };

  it("records the fingerprint that was reviewed, not a bare flag", () => {
    expect(withMark({}, target, true)).toEqual({ "src/a.ts": "+8 -4" });
  });

  it("returns the same object when the mark is already what was asked for", () => {
    const record = { "src/a.ts": "+8 -4" };
    expect(withMark(record, target, true)).toBe(record);
    expect(withMark({}, target, false)).toEqual({});
  });

  it("overwrites a stale fingerprint rather than keeping both", () => {
    expect(withMark({ "src/a.ts": "+1 -1" }, target, true)).toEqual({
      "src/a.ts": "+8 -4",
    });
  });

  it("clears a mark regardless of which fingerprint was stored", () => {
    expect(withMark({ "src/a.ts": "+1 -1" }, target, false)).toEqual({});
  });

  it("leaves other files alone", () => {
    expect(withMark({ "src/b.ts": "+2" }, target, true)).toEqual({
      "src/b.ts": "+2",
      "src/a.ts": "+8 -4",
    });
  });
});

describe("isViewed", () => {
  const record = { "src/a.ts": "+8 -4" };

  it("is true only for the exact diff that was marked", () => {
    expect(isViewed(record, { path: "src/a.ts", fingerprint: "+8 -4" })).toBe(
      true,
    );
  });

  it("clears itself when the file changes again", () => {
    expect(isViewed(record, { path: "src/a.ts", fingerprint: "+9 -4" })).toBe(
      false,
    );
  });

  it("is false for a file that was never marked", () => {
    expect(isViewed(record, { path: "src/b.ts", fingerprint: "+8 -4" })).toBe(
      false,
    );
  });
});

describe("prune", () => {
  it("drops marks for files no longer in the diff", () => {
    expect(prune({ "a.ts": "+1", "b.ts": "+2" }, ["a.ts"])).toEqual({
      "a.ts": "+1",
    });
  });

  it("returns the same object when every mark is still present", () => {
    const record = { "a.ts": "+1" };
    expect(prune(record, ["a.ts", "b.ts"])).toBe(record);
  });
});

describe("recordKey", () => {
  it("namespaces marks per thread", () => {
    expect(recordKey("thr_a")).not.toBe(recordKey("thr_b"));
    expect(recordKey("thr_a")).toBe("viewed:thr_a");
  });
});

function entry(path: string, overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return {
    path,
    previousPath: null,
    changeKind: "modified",
    additions: 8,
    deletions: 4,
    binary: false,
    ...overrides,
  };
}

describe("labelForEntry", () => {
  it("is the path for an ordinary file", () => {
    expect(labelForEntry(entry("src/a.ts"))).toBe("src/a.ts");
  });

  it("names both paths for a rename, the way the card does", () => {
    expect(
      labelForEntry(
        entry("src/b.ts", { changeKind: "renamed", previousPath: "src/a.ts" }),
      ),
    ).toBe("src/a.ts -> src/b.ts");
  });
});

describe("reviewProgress", () => {
  it("counts only files whose current diff is marked", () => {
    const record = {
      "src/a.ts": "+8 -4",
      "src/b.ts": "+1 -1",
      "src/gone.ts": "+8 -4",
    };
    expect(
      reviewProgress(record, [entry("src/a.ts"), entry("src/b.ts"), entry("src/c.ts")]),
    ).toEqual({ viewed: 1, total: 3 });
  });

  it("counts a binary image marked from its size stat", () => {
    expect(
      reviewProgress({ "logo.png": "none" }, [
        entry("logo.png", { binary: true, additions: 0, deletions: 0 }),
      ]),
    ).toEqual({ viewed: 1, total: 1 });
  });
});
