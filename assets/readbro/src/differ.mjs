/** Line-based unified diff (from cachebro SDK, MIT). */

export function computeDiff(oldContent, newContent, filePath) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lcs = longestCommonSubsequence(oldLines, newLines);

  const rawLines = [];
  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;
  let linesChanged = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (
      lcsIdx < lcs.length &&
      oldIdx < oldLines.length &&
      oldLines[oldIdx] === lcs[lcsIdx] &&
      newIdx < newLines.length &&
      newLines[newIdx] === lcs[lcsIdx]
    ) {
      rawLines.push({ type: "keep", line: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      oldIdx++;
      newIdx++;
      lcsIdx++;
    } else if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
      rawLines.push({ type: "add", line: newLines[newIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      newIdx++;
      linesChanged++;
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      rawLines.push({ type: "remove", line: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 });
      oldIdx++;
      linesChanged++;
    }
  }

  if (linesChanged === 0) {
    return { diff: "", linesChanged: 0, hasChanges: false };
  }

  const CONTEXT = 3;
  const hunkGroups = [];
  let currentHunk = [];
  let lastChangeIdx = -999;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.type !== "keep") {
      if (i - lastChangeIdx > CONTEXT * 2 + 1 && currentHunk.length > 0) {
        hunkGroups.push(currentHunk);
        currentHunk = [];
        for (let c = Math.max(0, i - CONTEXT); c < i; c++) {
          currentHunk.push(rawLines[c]);
        }
      } else if (currentHunk.length === 0) {
        for (let c = Math.max(0, i - CONTEXT); c < i; c++) {
          currentHunk.push(rawLines[c]);
        }
      }
      currentHunk.push(line);
      lastChangeIdx = i;
    } else if (i - lastChangeIdx <= CONTEXT && currentHunk.length > 0) {
      currentHunk.push(line);
    }
  }
  if (currentHunk.length > 0) hunkGroups.push(currentHunk);

  const hunks = [];
  for (const hunk of hunkGroups) {
    if (hunk.length === 0) continue;
    const firstLine = hunk[0];
    const lastLine = hunk[hunk.length - 1];
    hunks.push(
      `@@ -${firstLine.oldLine},${lastLine.oldLine - firstLine.oldLine + 1} +${firstLine.newLine},${lastLine.newLine - firstLine.newLine + 1} @@`,
    );
    for (const hl of hunk) {
      const prefix = hl.type === "add" ? "+" : hl.type === "remove" ? "-" : " ";
      hunks.push(`${prefix}${hl.line}`);
    }
  }

  const header = `--- a/${filePath} (IR)\n+++ b/${filePath} (IR)`;
  return {
    diff: `${header}\n${hunks.join("\n")}`,
    linesChanged,
    hasChanges: true,
  };
}

function longestCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return result;
}
