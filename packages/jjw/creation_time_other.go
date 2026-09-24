//go:build !darwin

package main

import (
	"os"
	"time"
)

func filesystemCreatedAt(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime(), nil
}
