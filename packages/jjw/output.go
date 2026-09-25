package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
)

func filterWorkspaces(rows []workspace, opts options) []workspace {
	filtered := make([]workspace, 0, len(rows))
	query := strings.ToLower(opts.filter)
	for _, row := range rows {
		if opts.kind != "" && !strings.Contains(row.Source, opts.kind) {
			continue
		}
		if opts.state != "" && row.State != opts.state {
			continue
		}
		if opts.action != "" && !actionMatches(row.Action, opts.action) {
			continue
		}
		if query != "" {
			searchable := strings.ToLower(strings.Join([]string{row.Name, row.Repository, row.Path, row.Source}, "\n"))
			if !strings.Contains(searchable, query) {
				continue
			}
		}
		filtered = append(filtered, row)
	}
	return filtered
}

func actionMatches(action string, filter string) bool {
	if filter == "protected" {
		return strings.HasPrefix(action, "protected-")
	}
	return action == filter
}

func renderReport(writer io.Writer, rows []workspace, opts options) error {
	switch opts.format {
	case "json":
		return renderJSON(writer, rows, opts)
	case "tsv":
		return renderDelimited(writer, rows, '\t', opts)
	case "csv":
		return renderDelimited(writer, rows, ',', opts)
	default:
		return renderTable(writer, rows, opts)
	}
}

func renderJSON(writer io.Writer, rows []workspace, opts options) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(struct {
		AgeBasis      string      `json:"age_basis"`
		OlderThanDays int         `json:"older_than_days"`
		Workspaces    []workspace `json:"workspaces"`
	}{
		AgeBasis:      opts.ageBasis,
		OlderThanDays: opts.olderThanDays,
		Workspaces:    rows,
	})
}

func renderDelimited(writer io.Writer, rows []workspace, delimiter rune, opts options) error {
	csvWriter := csv.NewWriter(writer)
	csvWriter.Comma = delimiter
	fields := []string{"source", "name", "repository", "path", "commit", "last_change", "created", "age_basis", "age_days"}
	if opts.withSize {
		fields = append(fields, "size_bytes")
	}
	fields = append(fields, "state", "action")
	if err := csvWriter.Write(fields); err != nil {
		return err
	}
	for _, row := range rows {
		if err := csvWriter.Write(workspaceFields(row, opts.ageBasis, opts.withSize)); err != nil {
			return err
		}
	}
	csvWriter.Flush()
	return csvWriter.Error()
}

func renderTable(writer io.Writer, rows []workspace, opts options) error {
	ageHeader := strings.ToUpper("age_days_" + strings.ReplaceAll(opts.ageBasis, "-", "_"))
	tabWriter := tabwriter.NewWriter(writer, 0, 0, 2, ' ', 0)
	fmt.Fprintf(tabWriter, "AGE BASIS: %s · REVIEW AFTER %d DAYS\n\n", opts.ageBasis, opts.olderThanDays)
	headers := []string{"SOURCE", "NAME", "REPOSITORY", "PATH", "COMMIT", "LAST CHANGE", "CREATED", ageHeader}
	if opts.withSize {
		headers = append(headers, "SIZE")
	}
	headers = append(headers, "STATE", "ACTION")
	fmt.Fprintln(tabWriter, strings.Join(headers, "\t"))
	for _, row := range rows {
		age := "?"
		if row.AgeDays != nil {
			age = fmt.Sprint(*row.AgeDays)
		}
		fields := []string{
			row.Source,
			displayValue(row.Name),
			displayValue(row.Repository),
			displayValue(row.Path),
			row.Commit,
			dateOrUnknown(row.LastChange),
			dateOrUnknown(row.Created),
			age,
		}
		if opts.withSize {
			fields = append(fields, formatWorkspaceSize(row.SizeBytes))
		}
		fields = append(fields, row.State, row.Action)
		fmt.Fprintln(tabWriter, strings.Join(fields, "\t"))
	}
	return tabWriter.Flush()
}

func workspaceFields(row workspace, ageBasis string, withSize bool) []string {
	age := ""
	if row.AgeDays != nil {
		age = fmt.Sprint(*row.AgeDays)
	}
	fields := []string{
		row.Source,
		row.Name,
		row.Repository,
		row.Path,
		row.Commit,
		row.LastChange,
		row.Created,
		ageBasis,
		age,
	}
	if withSize {
		sizeBytes := ""
		if row.SizeBytes != nil {
			sizeBytes = fmt.Sprint(*row.SizeBytes)
		}
		fields = append(fields, sizeBytes)
	}
	return append(fields, row.State, row.Action)
}

func displayValue(value string) string {
	return strings.NewReplacer("\n", "↵", "\r", "", "\t", "⇥").Replace(value)
}

func dateOrUnknown(value string) string {
	if value == "" {
		return "?"
	}
	return value
}
