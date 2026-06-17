/** Agent read patterns inspired by cachebro README + composto benchmark-proof. */

export const SCENARIOS = [
  {
    id: "single-stable",
    label: "Single file ×3 unchanged",
    detail: "Agent re-reads same file while reasoning (layers.ts)",
    steps: () => [
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/ir/layers.ts" },
    ],
  },
  {
    id: "single-edit",
    label: "Read → read → edit → read",
    detail: "Stable then file changes (layers.ts)",
    steps: () => [
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "edit", file: "src/ir/layers.ts", append: "\n// benchmark-edit\n" },
      { type: "read", file: "src/ir/layers.ts" },
    ],
  },
  {
    id: "multi-survey",
    label: "4-file survey ×2",
    detail: "composto benchmark-proof set — read all, re-read all unchanged",
    files: [
      "src/trends/hotspot.ts",
      "src/ir/layers.ts",
      "src/watcher/detector.ts",
      "src/ir/ast-walker.ts",
    ],
    steps(files) {
      return [...files.map((file) => ({ type: "read", file })), ...files.map((file) => ({ type: "read", file }))];
    },
  },
  {
    id: "multi-mixed",
    label: "Survey + re-read + edit + spot checks",
    detail: "Like cachebro multi-task session — survey, revisit, one edit, peek others",
    steps: () => [
      { type: "read", file: "src/trends/hotspot.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/watcher/detector.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "edit", file: "src/trends/hotspot.ts", append: "\n// benchmark-edit\n" },
      { type: "read", file: "src/trends/hotspot.ts" },
      { type: "read", file: "src/ir/layers.ts" },
    ],
  },
];

export const LAYERS = ["L0", "L1", "L3"];
