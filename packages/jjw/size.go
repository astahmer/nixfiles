package main

import (
	"fmt"
	"io/fs"
	"path/filepath"
)

func populateWorkspaceSizes(rows []workspace) []string {
	warnings := make([]string, len(rows))
	parallelFor(len(rows), func(index int) {
		sizeBytes, err := workspaceSize(rows[index].Path)
		if err != nil {
			warnings[index] = fmt.Sprintf("measure workspace size for %s: %v", rows[index].Path, err)
			return
		}
		rows[index].SizeBytes = &sizeBytes
	})
	filteredWarnings := make([]string, 0, len(warnings))
	for _, warning := range warnings {
		if warning != "" {
			filteredWarnings = append(filteredWarnings, warning)
		}
	}
	return filteredWarnings
}

func workspaceSize(root string) (int64, error) {
	var sizeBytes int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkError error) error {
		if walkError != nil {
			return walkError
		}
		if path != root && (entry.Name() == ".jj" || entry.Name() == ".git") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() || entry.Type()&fs.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			sizeBytes += info.Size()
		}
		return nil
	})
	return sizeBytes, err
}

func formatWorkspaceSize(sizeBytes *int64) string {
	if sizeBytes == nil {
		return "?"
	}
	const unit = 1000
	value := float64(*sizeBytes)
	units := []string{"B", "kB", "MB", "GB", "TB", "PB"}
	unitIndex := 0
	for value >= unit && unitIndex < len(units)-1 {
		value /= unit
		unitIndex++
	}
	if unitIndex == 0 {
		return fmt.Sprintf("%d %s", *sizeBytes, units[unitIndex])
	}
	return fmt.Sprintf("%.1f %s", value, units[unitIndex])
}
