//go:build darwin

package main

import (
	"fmt"
	"os"
	"syscall"
	"time"
)

func filesystemCreatedAt(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return time.Time{}, fmt.Errorf("read creation time for %s", path)
	}
	if stat.Birthtimespec.Sec == 0 && stat.Birthtimespec.Nsec == 0 {
		return time.Time{}, fmt.Errorf("creation time unavailable for %s", path)
	}
	return time.Unix(stat.Birthtimespec.Sec, stat.Birthtimespec.Nsec), nil
}
