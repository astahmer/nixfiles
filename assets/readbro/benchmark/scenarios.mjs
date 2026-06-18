/** Agent read patterns inspired by cachebro README + composto benchmark-proof. */

const PROOF_FILES = [
  "src/trends/hotspot.ts",
  "src/ir/layers.ts",
  "src/watcher/detector.ts",
  "src/ir/ast-walker.ts",
];

const LARGE_FILES = [
  "src/context/packer.ts",
  "src/mcp/server.ts",
  "src/cli/init.ts",
  "src/cli/commands.ts",
  "src/ir/ast-walker.ts",
];

function reads(file, count) {
  return Array.from({ length: count }, () => ({ type: "read", file }));
}

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
    files: PROOF_FILES,
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
  {
    id: "big-stable-x5",
    label: "Large file ×5 unchanged",
    detail: "commands.ts (~16k) — agent keeps re-opening while planning",
    steps: () => reads("src/cli/commands.ts", 5),
  },
  {
    id: "big-edit-chain",
    label: "Large file — 2 edits, 4 re-reads",
    detail: "ast-walker.ts (~24k) — iterative refactor loop",
    steps: () => [
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "edit", file: "src/ir/ast-walker.ts", append: "\n// benchmark-edit-1\n" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "edit", file: "src/ir/ast-walker.ts", append: "\n// benchmark-edit-2\n" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
    ],
  },
  {
    id: "multi-edit-tour",
    label: "3 files ×2 edits each",
    detail: "Edit tour across large + medium files with reads between",
    steps: () => [
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/mcp/server.ts" },
      { type: "edit", file: "src/cli/commands.ts", append: "\n// edit-a\n" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "edit", file: "src/mcp/server.ts", append: "\n// edit-b\n" },
      { type: "read", file: "src/mcp/server.ts" },
      { type: "edit", file: "src/ir/layers.ts", append: "\n// edit-c\n" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "edit", file: "src/cli/commands.ts", append: "\n// edit-a2\n" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "edit", file: "src/mcp/server.ts", append: "\n// edit-b2\n" },
      { type: "read", file: "src/mcp/server.ts" },
      { type: "read", file: "src/ir/layers.ts" },
    ],
  },
  {
    id: "large-survey-x2",
    label: "9-file large survey ×2",
    detail: "proof + large files — full pass twice",
    files: [...new Set([...PROOF_FILES, ...LARGE_FILES])],
    steps(files) {
      return [...files.map((file) => ({ type: "read", file })), ...files.map((file) => ({ type: "read", file }))];
    },
  },
  {
    id: "hot-loop",
    label: "Big-file ping-pong + edits",
    detail: "commands.ts ↔ ast-walker.ts loop (cachebro-style long session)",
    steps: () => [
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "edit", file: "src/cli/commands.ts", append: "\n// hot-edit\n" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "edit", file: "src/ir/ast-walker.ts", append: "\n// hot-edit\n" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/ir/ast-walker.ts" },
      { type: "read", file: "src/cli/commands.ts" },
    ],
  },
  {
    id: "cachebro-3-task",
    label: "3-task cumulative session",
    detail: "Mimics cachebro README — growing revisit savings across tasks",
    steps: () => [
      // task 1: discover 4 files
      ...PROOF_FILES.map((file) => ({ type: "read", file })),
      ...PROOF_FILES.map((file) => ({ type: "read", file })),
      // task 2: deepen on 2 large + revisit proof
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/context/packer.ts" },
      { type: "read", file: "src/ir/layers.ts" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/context/packer.ts" },
      { type: "edit", file: "src/ir/layers.ts", append: "\n// task2\n" },
      { type: "read", file: "src/ir/layers.ts" },
      // task 3: heavy revisit + edits
      ...LARGE_FILES.slice(0, 3).map((file) => ({ type: "read", file })),
      ...LARGE_FILES.slice(0, 3).map((file) => ({ type: "read", file })),
      { type: "edit", file: "src/cli/commands.ts", append: "\n// task3\n" },
      { type: "read", file: "src/cli/commands.ts" },
      { type: "read", file: "src/mcp/server.ts" },
      { type: "read", file: "src/cli/commands.ts" },
    ],
  },
  {
    id: "layer-drill",
    label: "L0 → L1 drill ×4 files",
    detail: "Survey then deepen — per-step layers, no cross-layer diff savings",
    perStepLayers: true,
    steps: () => [
      { type: "read", file: "src/ir/layers.ts", layer: "L0" },
      { type: "read", file: "src/ir/layers.ts", layer: "L1" },
      { type: "read", file: "src/trends/hotspot.ts", layer: "L0" },
      { type: "read", file: "src/trends/hotspot.ts", layer: "L1" },
      { type: "read", file: "src/watcher/detector.ts", layer: "L0" },
      { type: "read", file: "src/watcher/detector.ts", layer: "L1" },
      { type: "read", file: "src/ir/ast-walker.ts", layer: "L0" },
      { type: "read", file: "src/ir/ast-walker.ts", layer: "L1" },
    ],
  },
];

export const LAYERS = ["L0", "L1", "L3"];

export { PROOF_FILES, LARGE_FILES };
