export type RevisionGraphInput = {
  commitId: string;
  parents: readonly string[];
};

export type RevisionGraphOrderInput = RevisionGraphInput & { timestamp: number };

export const orderRevisionsByRecency = <T extends RevisionGraphOrderInput>(
  revisions: readonly T[],
): T[] => {
  const byId = new Map(revisions.map((revision, index) => [revision.commitId, { revision, index }]));
  const childCounts = new Map(revisions.map((revision) => [revision.commitId, 0]));

  revisions.forEach((revision) => {
    for (const parentId of new Set(revision.parents)) {
      if (!byId.has(parentId)) continue;
      childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
    }
  });

  const ready = revisions
    .filter((revision) => childCounts.get(revision.commitId) === 0)
    .map((revision) => revision.commitId);
  const ordered: T[] = [];
  const emitted = new Set<string>();

  while (ready.length > 0) {
    ready.sort((leftId, rightId) => {
      const left = byId.get(leftId);
      const right = byId.get(rightId);
      if (!left || !right) return 0;
      return right.revision.timestamp - left.revision.timestamp || left.index - right.index;
    });
    const commitId = ready.shift();
    if (!commitId) continue;
    const item = byId.get(commitId);
    if (!item) continue;
    ordered.push(item.revision);
    emitted.add(commitId);

    for (const parentId of new Set(item.revision.parents)) {
      if (!byId.has(parentId)) continue;
      const remaining = (childCounts.get(parentId) ?? 0) - 1;
      childCounts.set(parentId, remaining);
      if (remaining === 0) ready.push(parentId);
    }
  }

  if (ordered.length !== revisions.length) {
    return [...ordered, ...revisions.filter((revision) => !emitted.has(revision.commitId))];
  }
  return ordered;
};

export type RevisionGraphEdge = {
  fromLane: number;
  toLane: number;
  kind: "straight" | "merge";
};

export type RevisionGraphRow = {
  commitLane: number;
  laneCount: number;
  topLanes: number[];
  bottomLanes: number[];
  edges: RevisionGraphEdge[];
  startsHere: boolean;
};

const firstOpenLane = (lanes: Array<string | null>, fromLane = 0) => {
  for (let lane = fromLane; lane < lanes.length; lane += 1) {
    if (lanes[lane] === null) return lane;
  }
  return lanes.length;
};

export const layoutRevisionGraph = (
  revisions: readonly RevisionGraphInput[],
): RevisionGraphRow[] => {
  const lanes: Array<string | null> = [];
  const rows: RevisionGraphRow[] = [];

  for (const revision of revisions) {
    let commitLane = lanes.indexOf(revision.commitId);
    const startsHere = commitLane < 0;
    if (startsHere) {
      commitLane = firstOpenLane(lanes);
      lanes[commitLane] = revision.commitId;
    }

    const topLanes = lanes
      .map((commitId, lane) => (commitId === null || lane === commitLane ? -1 : lane))
      .filter((lane) => lane >= 0);
    const nextLanes = [...lanes];
    nextLanes[commitLane] = null;
    const edges = revision.parents.map((parentId, parentIndex) => {
      let targetLane = nextLanes.indexOf(parentId);
      if (targetLane < 0) {
        targetLane =
          parentIndex === 0 && nextLanes[commitLane] === null
            ? commitLane
            : firstOpenLane(nextLanes, commitLane + 1);
        nextLanes[targetLane] = parentId;
      }
      return {
        fromLane: commitLane,
        toLane: targetLane,
        kind: targetLane === commitLane ? ("straight" as const) : ("merge" as const),
      };
    });

    while (nextLanes.length > 0 && nextLanes.at(-1) === null) nextLanes.pop();
    const bottomLanes = nextLanes
      .map((commitId, lane) => (commitId === null ? -1 : lane))
      .filter((lane) => lane >= 0 && !edges.some((edge) => edge.toLane === lane));
    rows.push({
      commitLane,
      laneCount: Math.max(lanes.length, nextLanes.length, commitLane + 1),
      topLanes,
      bottomLanes,
      edges,
      startsHere,
    });
    lanes.splice(0, lanes.length, ...nextLanes);
  }

  return rows;
};
