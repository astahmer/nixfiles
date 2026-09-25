package main

import (
	"fmt"
	"os"
	"slices"
	"strings"

	"charm.land/bubbles/v2/textinput"
	"charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

type browserScanMsg struct {
	generation uint64
	rows       []workspace
	warnings   []string
	err        error
}

type browserStatesMsg struct {
	generation uint64
	rows       []workspace
	warnings   []string
}

type browserSizesMsg struct {
	generation uint64
	rows       []workspace
	warnings   []string
}

type browserModel struct {
	options          options
	rows             []workspace
	visible          []workspace
	filterInput      textinput.Model
	currentDirectory string
	width            int
	height           int
	selected         int
	generation       uint64
	loading          bool
	filtering        bool
	showHelp         bool
	statesLoading    bool
	sizesLoaded      bool
	sizesLoading     bool
	warnings         []string
	status           string
	err              error
}

var (
	browserTitleStyle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#8bd5ca"))
	browserMutedStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#8b91a1"))
	browserAccentStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#a6da95"))
	browserWarningStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#eed49f"))
	browserSelectedStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#1e2030")).Background(lipgloss.Color("#8bd5ca"))
	browserBorderStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#494d64"))
)

func runBrowser(opts options) error {
	if !terminalAvailable() {
		return fmt.Errorf("jjw browse requires an interactive terminal; use jjw list for non-interactive output")
	}

	currentDirectory, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("find current directory: %w", err)
	}
	if resolvedDirectory, resolveErr := canonicalDirectory(currentDirectory); resolveErr == nil {
		currentDirectory = resolvedDirectory
	}

	model := newBrowserModel(opts, currentDirectory)
	finalModel, err := tea.NewProgram(model).Run()
	if err != nil {
		return err
	}
	finalBrowser, ok := finalModel.(*browserModel)
	if !ok {
		return nil
	}
	return finalBrowser.err
}

func newBrowserModel(opts options, currentDirectory string) *browserModel {
	if opts.sortBy == "" {
		opts.sortBy = "last-change"
	}
	filterInput := textinput.New()
	filterInput.Prompt = "/ "
	filterInput.Placeholder = "filter workspaces"
	filterInput.CharLimit = 256
	filterInput.SetValue(opts.filter)
	return &browserModel{
		options:          opts,
		filterInput:      filterInput,
		currentDirectory: currentDirectory,
		loading:          true,
		generation:       1,
		status:           "Scanning workspaces…",
	}
}

func (m *browserModel) Init() tea.Cmd {
	return m.scanCommand(m.generation)
}

func (m *browserModel) Update(message tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := message.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.filterInput.SetWidth(max(12, msg.Width-8))
		return m, nil
	case browserScanMsg:
		if msg.generation != m.generation {
			return m, nil
		}
		m.loading = false
		m.warnings = slices.Clone(msg.warnings)
		if msg.err != nil {
			m.err = msg.err
			m.status = "Workspace scan failed"
			return m, nil
		}
		m.rows = msg.rows
		m.sizesLoaded = false
		m.status = fmt.Sprintf("Loaded %d workspaces", len(m.rows))
		m.refreshVisible()
		commands := make([]tea.Cmd, 0, 2)
		if m.options.checkState {
			m.statesLoading = true
			commands = append(commands, m.statesCommand(m.generation))
		}
		if m.options.withSize {
			m.sizesLoading = true
			commands = append(commands, m.sizesCommand(m.generation))
		}
		return m, tea.Batch(commands...)
	case browserStatesMsg:
		if msg.generation != m.generation {
			return m, nil
		}
		mergeWorkspaceStateFields(m.rows, msg.rows)
		m.statesLoading = false
		m.warnings = append(m.warnings, msg.warnings...)
		m.status = "Workspace state refreshed"
		m.refreshVisible()
		return m, nil
	case browserSizesMsg:
		if msg.generation != m.generation {
			return m, nil
		}
		mergeWorkspaceSizeFields(m.rows, msg.rows)
		m.sizesLoading = false
		m.sizesLoaded = true
		m.warnings = append(m.warnings, msg.warnings...)
		m.status = "Workspace sizes measured"
		m.refreshVisible()
		return m, nil
	case tea.KeyPressMsg:
		return m.updateKey(msg)
	}
	return m, nil
}

func (m *browserModel) updateKey(message tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	key := message.String()
	if m.filtering {
		switch key {
		case "enter", "esc":
			m.filtering = false
			m.filterInput.Blur()
			if key == "esc" {
				m.filterInput.SetValue(m.options.filter)
			}
			m.options.filter = m.filterInput.Value()
			m.refreshVisible()
			return m, nil
		case "ctrl+c":
			return m, tea.Quit
		}
		updatedInput, command := m.filterInput.Update(message)
		m.filterInput = updatedInput
		m.options.filter = m.filterInput.Value()
		m.refreshVisible()
		return m, command
	}

	switch key {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "esc":
		if m.showHelp {
			m.showHelp = false
			return m, nil
		}
		return m, tea.Quit
	case "/":
		m.filtering = true
		command := m.filterInput.Focus()
		return m, command
	case "j", "down":
		m.moveSelection(1)
	case "k", "up":
		m.moveSelection(-1)
	case "s":
		return m, m.cycleSort()
	case "v":
		m.options.reverse = !m.options.reverse
		m.refreshVisible()
		m.status = fmt.Sprintf("Sort order reversed: %s", m.sortDescription())
	case "u":
		return m, m.refreshStates()
	case "z":
		return m, m.measureSizes()
	case "ctrl+r":
		return m, m.refreshWorkspaces()
	case "?":
		m.showHelp = !m.showHelp
	}
	return m, nil
}

func (m *browserModel) View() tea.View {
	view := tea.NewView(m.render())
	view.AltScreen = true
	return view
}

func (m *browserModel) render() string {
	if m.width > 0 && m.width < 72 {
		return fmt.Sprintf("jjw needs a terminal at least 72 columns wide (current: %d).\nResize the terminal or run jjw list.", m.width)
	}
	if m.height > 0 && m.height < 14 {
		return fmt.Sprintf("jjw needs a terminal at least 14 rows tall (current: %d).\nResize the terminal or run jjw list.", m.height)
	}
	width := max(m.width, 72)
	height := max(m.height, 18)
	contentWidth := max(40, width-4)
	lines := make([]string, 0, height)
	lines = append(lines, browserTitleStyle.Render(" jjw ")+"  "+browserMutedStyle.Render("workspace explorer"))
	lines = append(lines, browserMutedStyle.Render(fmt.Sprintf(" %d workspaces · sorted by %s · review after %d days", len(m.visible), m.sortDescription(), m.options.olderThanDays)))
	if m.showHelp {
		lines = append(lines, "", browserTitleStyle.Render("Keyboard help"))
		lines = append(lines, "  j/k or arrows   move selection")
		lines = append(lines, "  /               edit live fuzzy filter")
		lines = append(lines, "  s               cycle sort field")
		lines = append(lines, "  v               reverse current sort")
		lines = append(lines, "  u               check workspace dirty state")
		lines = append(lines, "  z               measure workspace sizes")
		lines = append(lines, "  ctrl+r          rescan workspace roots")
		lines = append(lines, "  ? or esc        close this help")
		lines = append(lines, "  q               quit")
		return strings.Join(lines, "\n")
	}
	if m.filtering {
		lines = append(lines, " "+m.filterInput.View())
	} else {
		query := m.options.filter
		if query == "" {
			query = "type / to filter"
		}
		lines = append(lines, " "+browserMutedStyle.Render("filter: ")+browserAccentStyle.Render(query))
	}
	lines = append(lines, "")

	bodyHeight := height - len(lines) - 4
	if bodyHeight < 4 {
		bodyHeight = 4
	}
	if width >= 112 {
		listWidth := contentWidth * 61 / 100
		detailWidth := contentWidth - listWidth - 1
		left := m.renderList(listWidth, bodyHeight)
		right := m.renderDetails(detailWidth, bodyHeight)
		joined := lipgloss.JoinHorizontal(lipgloss.Top, strings.Join(left, "\n"), browserBorderStyle.Render("│"), strings.Join(right, "\n"))
		lines = append(lines, strings.Split(joined, "\n")...)
	} else {
		lines = append(lines, m.renderList(contentWidth, bodyHeight)...)
	}

	lines = append(lines, "")
	lines = append(lines, m.renderStatus(contentWidth))
	lines = append(lines, browserMutedStyle.Render(" j/k move  / filter  s sort  v reverse  u status  z size  ctrl+r refresh  ? help  q quit"))
	return strings.Join(lines, "\n")
}

func (m *browserModel) renderList(width int, height int) []string {
	if m.loading {
		return []string{browserMutedStyle.Render("Scanning workspace roots…")}
	}
	if m.err != nil {
		return []string{browserWarningStyle.Render(m.err.Error())}
	}
	if len(m.visible) == 0 {
		return []string{browserMutedStyle.Render("No workspaces match this filter.")}
	}

	sourceWidth := 4
	dateWidth := 10
	ageWidth := 5
	sizeWidth := 8
	stateWidth := 8
	separators := 6
	nameWidth := max(9, width*28/100)
	repositoryWidth := width - sourceWidth - dateWidth - ageWidth - sizeWidth - stateWidth - separators - nameWidth
	if repositoryWidth < 8 {
		nameWidth = max(9, nameWidth-(8-repositoryWidth))
		repositoryWidth = max(1, width-sourceWidth-dateWidth-ageWidth-sizeWidth-stateWidth-separators-nameWidth)
	}
	columns := []string{
		padCell("SRC", sourceWidth),
		padCell("WORKSPACE", nameWidth),
		padCell("REPOSITORY", repositoryWidth),
		padCell("LAST CHANGE", dateWidth),
		padCell("AGE", ageWidth),
		padCell("SIZE", sizeWidth),
		padCell("STATE", stateWidth),
	}
	lines := []string{browserMutedStyle.Render(strings.Join(columns, " "))}
	visibleHeight := max(1, height-1)
	start := max(0, m.selected-visibleHeight+1)
	end := min(len(m.visible), start+visibleHeight)
	for index := start; index < end; index++ {
		row := m.visible[index]
		size := "—"
		if m.sizesLoading {
			size = "…"
		}
		if row.SizeBytes != nil {
			size = formatWorkspaceSize(row.SizeBytes)
		}
		age := "?"
		if row.AgeDays != nil {
			age = fmt.Sprintf("%dd", *row.AgeDays)
		}
		state := row.State
		if state == "unchecked" && m.statesLoading {
			state = "checking…"
		}
		cells := []string{
			padCell(strings.ToUpper(row.Source), sourceWidth),
			padCell(row.Name, nameWidth),
			padCell(row.Repository, repositoryWidth),
			padCell(dateOrUnknown(row.LastChange), dateWidth),
			padCell(age, ageWidth),
			padCell(size, sizeWidth),
			padCell(state, stateWidth),
		}
		line := strings.Join(cells, " ")
		if index == m.selected {
			line = browserSelectedStyle.Render(line)
		}
		lines = append(lines, line)
	}
	return lines
}

func (m *browserModel) renderDetails(width int, height int) []string {
	lines := []string{browserTitleStyle.Render("SELECTED WORKSPACE")}
	if len(m.visible) == 0 {
		return append(lines, browserMutedStyle.Render("Nothing selected"))
	}
	row := m.visible[m.selected]
	name := row.Name
	if name == "" {
		name = "(unnamed)"
	}
	lines = append(lines, browserAccentStyle.Render(truncateBrowserText(name, width)))
	lines = append(lines, "")
	lines = append(lines, detailLine("Source", row.Source, width))
	lines = append(lines, detailLine("Repository", row.Repository, width))
	lines = append(lines, detailLine("Path", row.Path, width))
	lines = append(lines, detailLine("Commit", row.Commit, width))
	lines = append(lines, detailLine("Last change", dateOrUnknown(row.LastChange), width))
	lines = append(lines, detailLine("Created", dateOrUnknown(row.Created), width))
	age := "?"
	if row.AgeDays != nil {
		age = fmt.Sprintf("%d days (%s)", *row.AgeDays, m.options.ageBasis)
	}
	lines = append(lines, detailLine("Age", age, width))
	size := "not measured (z)"
	if m.sizesLoading {
		size = "measuring…"
	}
	if row.SizeBytes != nil {
		size = formatWorkspaceSize(row.SizeBytes)
	}
	lines = append(lines, detailLine("Size", size, width))
	state := row.State
	if state == "unchecked" {
		state = "unchecked (u)"
	}
	lines = append(lines, detailLine("State", state, width))
	lines = append(lines, detailLine("Action", row.Action, width))
	for len(lines) < height {
		lines = append(lines, "")
	}
	return lines[:min(len(lines), height)]
}

func (m *browserModel) renderStatus(width int) string {
	status := m.status
	if m.loading {
		status = "Scanning workspaces…"
	}
	if m.statesLoading || m.sizesLoading {
		status += "  Background checks running"
	}
	if len(m.warnings) > 0 {
		status += "  ·  " + m.warnings[0]
		if len(m.warnings) > 1 {
			status += fmt.Sprintf("  (+%d more)", len(m.warnings)-1)
		}
	}
	if status == "" {
		status = fmt.Sprintf("Showing %d of %d workspaces", len(m.visible), len(m.rows))
	}
	return browserWarningStyle.Width(width).Render(" " + truncateBrowserText(status, width-2))
}

func (m *browserModel) refreshVisible() {
	selectedIdentity := ""
	if m.selected >= 0 && m.selected < len(m.visible) {
		selectedIdentity = workspaceIdentity(m.visible[m.selected])
	}
	sortWorkspaces(m.rows, m.options)
	m.visible = filterBrowserWorkspaces(m.rows, m.options)
	if len(m.visible) == 0 {
		m.selected = 0
		return
	}
	if selectedIdentity != "" {
		for index, row := range m.visible {
			if workspaceIdentity(row) == selectedIdentity {
				m.selected = index
				return
			}
		}
	}
	m.selected = min(m.selected, len(m.visible)-1)
}

func (m *browserModel) moveSelection(delta int) {
	if len(m.visible) == 0 {
		return
	}
	m.selected = min(len(m.visible)-1, max(0, m.selected+delta))
}

func (m *browserModel) cycleSort() tea.Cmd {
	sorts := []string{"last-change", "age", "created", "size", "name", "repository", "state", "action"}
	currentIndex := 0
	for index, sortBy := range sorts {
		if sortBy == m.options.sortBy {
			currentIndex = index
			break
		}
	}
	m.options.sortBy = sorts[(currentIndex+1)%len(sorts)]
	m.options.reverse = false
	m.refreshVisible()
	m.status = fmt.Sprintf("Sorted by %s", m.sortDescription())
	commands := make([]tea.Cmd, 0, 1)
	if m.options.sortBy == "size" {
		commands = append(commands, m.measureSizes())
	}
	if m.options.sortBy == "state" || m.options.sortBy == "action" {
		commands = append(commands, m.refreshStates())
	}
	return tea.Batch(commands...)
}

func (m *browserModel) sortDescription() string {
	descending := m.options.sortBy == "last-change" || m.options.sortBy == "age" || m.options.sortBy == "created" || m.options.sortBy == "size"
	if m.options.reverse {
		descending = !descending
	}
	if descending {
		return m.options.sortBy + " ↓"
	}
	return m.options.sortBy + " ↑"
}

func (m *browserModel) scanCommand(generation uint64) tea.Cmd {
	opts := m.options
	opts.checkState = false
	return func() tea.Msg {
		rows, warnings, err := scanWorkspaces(opts)
		return browserScanMsg{generation: generation, rows: rows, warnings: warnings, err: err}
	}
}

func (m *browserModel) refreshWorkspaces() tea.Cmd {
	m.generation++
	m.loading = true
	m.statesLoading = false
	m.sizesLoaded = false
	m.sizesLoading = false
	m.rows = nil
	m.visible = nil
	m.selected = 0
	m.warnings = nil
	m.err = nil
	m.status = "Rescanning workspace roots…"
	return m.scanCommand(m.generation)
}

func (m *browserModel) refreshStates() tea.Cmd {
	if m.loading || m.statesLoading || len(m.rows) == 0 {
		return nil
	}
	m.statesLoading = true
	m.status = "Checking workspace state…"
	return m.statesCommand(m.generation)
}

func (m *browserModel) measureSizes() tea.Cmd {
	if m.loading || m.sizesLoading || m.sizesLoaded || len(m.rows) == 0 {
		return nil
	}
	m.sizesLoading = true
	m.status = "Measuring workspace sizes…"
	return m.sizesCommand(m.generation)
}

func (m *browserModel) statesCommand(generation uint64) tea.Cmd {
	rows := slices.Clone(m.rows)
	currentDirectory := m.currentDirectory
	olderThanDays := m.options.olderThanDays
	return func() tea.Msg {
		warnings := populateWorkspaceStates(rows)
		for index := range rows {
			rows[index].Action = workspaceAction(rows[index], currentDirectory, olderThanDays)
		}
		return browserStatesMsg{generation: generation, rows: rows, warnings: warnings}
	}
}

func (m *browserModel) sizesCommand(generation uint64) tea.Cmd {
	rows := slices.Clone(m.rows)
	return func() tea.Msg {
		warnings := populateWorkspaceSizes(rows)
		return browserSizesMsg{generation: generation, rows: rows, warnings: warnings}
	}
}

func mergeWorkspaceStateFields(target []workspace, source []workspace) {
	states := make(map[string]workspace, len(source))
	for _, row := range source {
		states[workspaceIdentity(row)] = row
	}
	for targetIndex := range target {
		if state, found := states[workspaceIdentity(target[targetIndex])]; found {
			target[targetIndex].State = state.State
			target[targetIndex].Action = state.Action
		}
	}
}

func mergeWorkspaceSizeFields(target []workspace, source []workspace) {
	sizes := make(map[string]workspace, len(source))
	for _, row := range source {
		sizes[workspaceIdentity(row)] = row
	}
	for targetIndex := range target {
		if size, found := sizes[workspaceIdentity(target[targetIndex])]; found {
			target[targetIndex].SizeBytes = size.SizeBytes
		}
	}
}

func workspaceIdentity(row workspace) string {
	return row.Source + "\x00" + row.Path
}

func detailLine(label string, value string, width int) string {
	labelWidth := min(12, max(8, width/3))
	valueWidth := max(1, width-labelWidth-1)
	return browserMutedStyle.Render(padCell(label, labelWidth)+" ") + truncateBrowserText(value, valueWidth)
}

func padCell(value string, width int) string {
	return ansi.Truncate(value, width, "…") + strings.Repeat(" ", max(0, width-ansi.StringWidth(ansi.Truncate(value, width, "…"))))
}

func truncateBrowserText(value string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(value, width, "…")
}

func filterBrowserWorkspaces(rows []workspace, opts options) []workspace {
	filtered := make([]workspace, 0, len(rows))
	queryTerms := strings.Fields(strings.ToLower(opts.filter))
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
		searchable := strings.ToLower(strings.Join([]string{
			row.Name,
			row.Repository,
			row.Path,
			row.Source,
			row.LastChange,
			row.Created,
			row.State,
			row.Action,
		}, " "))
		matches := true
		for _, term := range queryTerms {
			if !matchesFuzzyTerm(searchable, term) {
				matches = false
				break
			}
		}
		if matches {
			filtered = append(filtered, row)
		}
	}
	return filtered
}

func matchesFuzzyTerm(value string, term string) bool {
	valueRunes := []rune(value)
	termRunes := []rune(term)
	termIndex := 0
	for _, valueRune := range valueRunes {
		if valueRune != termRunes[termIndex] {
			continue
		}
		termIndex++
		if termIndex == len(termRunes) {
			return true
		}
	}
	return false
}
