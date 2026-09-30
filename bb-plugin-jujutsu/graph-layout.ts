export type RevisionGraphInput = {
  commitId: string;
  parents: readonly string[];
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

const firstOpenLane = (lanes: Array<string | null>) => {
  const openLane = lanes.indexOf(null);
  return openLane < 0 ? lanes.length : openLane;
};

export const layoutRevisionGraph = (revisions: readonly RevisionGraphInput[]): RevisionGraphRow[] => {
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
      .map((commitId, lane) => commitId === null || lane === commitLane ? -1 : lane)
      .filter((lane) => lane >= 0);
    const nextLanes = [...lanes];
    nextLanes[commitLane] = null;
    const edges = revision.parents.map((parentId, parentIndex) => {
      let targetLane = nextLanes.indexOf(parentId);
      if (targetLane < 0) {
        targetLane = parentIndex === 0 && nextLanes[commitLane] === null
          ? commitLane
          : firstOpenLane(nextLanes);
        nextLanes[targetLane] = parentId;
      }
      return {
        fromLane: commitLane,
        toLane: targetLane,
        kind: targetLane === commitLane ? "straight" as const : "merge" as const,
      };
    });

    while (nextLanes.length > 0 && nextLanes.at(-1) === null) nextLanes.pop();
    const bottomLanes = nextLanes
      .map((commitId, lane) => commitId === null ? -1 : lane)
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
