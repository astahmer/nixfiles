package main

import (
	"sort"
	"strings"
)

func sortWorkspaces(rows []workspace, opts options) {
	if opts.sortBy == "" {
		return
	}
	descending := opts.sortBy == "last-change" || opts.sortBy == "age" || opts.sortBy == "created" || opts.sortBy == "size"
	if opts.reverse {
		descending = !descending
	}
	sort.SliceStable(rows, func(leftIndex int, rightIndex int) bool {
		left := rows[leftIndex]
		right := rows[rightIndex]
		leftMissing := workspaceSortValueMissing(left, opts.sortBy)
		rightMissing := workspaceSortValueMissing(right, opts.sortBy)
		if leftMissing != rightMissing {
			return !leftMissing
		}
		if leftMissing {
			return compareWorkspacePath(left, right) < 0
		}
		comparison := compareWorkspaceValues(left, right, opts.sortBy)
		if comparison != 0 {
			if descending {
				return comparison > 0
			}
			return comparison < 0
		}
		return compareWorkspacePath(left, right) < 0
	})
}

func workspaceSortValueMissing(row workspace, sortBy string) bool {
	switch sortBy {
	case "last-change":
		return row.LastChange == ""
	case "age":
		return row.AgeDays == nil
	case "created":
		return row.Created == ""
	case "size":
		return row.SizeBytes == nil
	default:
		return false
	}
}

func compareWorkspaceValues(left workspace, right workspace, sortBy string) int {
	switch sortBy {
	case "last-change":
		return strings.Compare(left.LastChange, right.LastChange)
	case "age":
		return compareInts(*left.AgeDays, *right.AgeDays)
	case "created":
		return strings.Compare(left.Created, right.Created)
	case "size":
		return compareInt64s(*left.SizeBytes, *right.SizeBytes)
	case "name":
		return strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name))
	case "repository":
		return strings.Compare(strings.ToLower(left.Repository), strings.ToLower(right.Repository))
	case "state":
		return compareInts(stateSortOrder(left.State), stateSortOrder(right.State))
	case "action":
		return compareInts(actionSortOrder(left.Action), actionSortOrder(right.Action))
	default:
		return 0
	}
}

func stateSortOrder(state string) int {
	switch state {
	case "dirty":
		return 0
	case "unknown":
		return 1
	case "clean":
		return 2
	default:
		return 3
	}
}

func actionSortOrder(action string) int {
	switch {
	case action == "review":
		return 0
	case action == "recent":
		return 1
	case strings.HasPrefix(action, "protected-"):
		return 2
	default:
		return 3
	}
}

func compareInts(left int, right int) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareInt64s(left int64, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func compareWorkspacePath(left workspace, right workspace) int {
	if comparison := strings.Compare(left.Repository, right.Repository); comparison != 0 {
		return comparison
	}
	if comparison := strings.Compare(left.Path, right.Path); comparison != 0 {
		return comparison
	}
	return strings.Compare(left.Source, right.Source)
}
