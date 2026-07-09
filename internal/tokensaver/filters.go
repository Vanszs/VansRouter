package tokensaver

import (
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// RTK constants — mirror Node.js open-sse/rtk/constants.js
const (
	rtkDetectWindow          = 1024
	rtkGitDiffHunkMaxLines   = 100
	rtkDedupLineMax          = 2000
	rtkGrepPerFileMax        = 10
	rtkFindPerDirMax         = 10
	rtkFindTotalDirMax       = 20
	rtkStatusMaxFiles        = 10
	rtkStatusMaxUntracked    = 10
	rtkLSExtSummaryTop       = 5
	rtkTreeMaxLines          = 200
	rtkSearchListPerDirMax   = 10
	rtkSearchListTotalDirMax = 20
	rtkReadNumberedMinRatio  = 0.7
)

var lsNoiseDirs = map[string]bool{
	"node_modules": true, ".git": true, "target": true, "__pycache__": true,
	".next": true, "dist": true, "build": true, ".cache": true, ".turbo": true,
	".vercel": true, ".pytest_cache": true, ".mypy_cache": true, ".tox": true,
	".venv": true, "venv": true, "env": true, "coverage": true, ".nyc_output": true,
	".DS_Store": true, "Thumbs.db": true, ".idea": true, ".vscode": true, ".vs": true,
	"*.egg-info": true, ".eggs": true,
}

// FilterFunc compresses tool-result text. Returns filtered text.
type FilterFunc func(string) string

// FilterName returns the human-readable name of a filter for stats tracking.
func FilterName(f FilterFunc) string {
	// Use pointer comparison via map since funcs can't be compared with switch
	names := map[uintptr]string{
		funcPC(gitDiffFilter):        "git-diff",
		funcPC(gitStatusFilter):      "git-status",
		funcPC(buildOutputFilter):    "build-output",
		funcPC(grepFilter):           "grep",
		funcPC(findFilter):           "find",
		funcPC(treeFilter):           "tree",
		funcPC(lsFilter):             "ls",
		funcPC(searchListFilter):     "search-list",
		funcPC(readNumberedFilter):   "read-numbered",
		funcPC(dedupLogFilter):       "dedup-log",
		funcPC(smartTruncateFilter):  "smart-truncate",
	}
	if name, ok := names[funcPC(f)]; ok {
		return name
	}
	return "unknown"
}

func funcPC(f FilterFunc) uintptr {
	return reflect.ValueOf(f).Pointer()
}

// autoDetectFilter inspects the first DETECT_WINDOW chars and returns the
// matching filter function, or nil if no filter applies.
// Port of open-sse/rtk/autodetect.js
func autoDetectFilter(text string) FilterFunc {
	head := text
	if len(text) > rtkDetectWindow {
		head = text[:rtkDetectWindow]
	}

	if reGitDiff.MatchString(head) || reGitDiffHunk.MatchString(head) {
		return gitDiffFilter
	}
	if reGitStatus.MatchString(head) {
		return gitStatusFilter
	}
	// Build output BEFORE porcelain check
	if reBuildOutput.MatchString(head) {
		return buildOutputFilter
	}
	if isMostlyPorcelain(head) {
		return gitStatusFilter
	}

	lines := strings.Split(head, "\n")
	var nonEmpty []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			nonEmpty = append(nonEmpty, l)
		}
	}

	// Grep: first 5 non-empty lines, ANY matches "file:number:content"
	first5 := nonEmpty
	if len(first5) > 5 {
		first5 = first5[:5]
	}
	for _, l := range first5 {
		if isGrepLine(l) {
			return grepFilter
		}
	}

	// Find: ALL non-empty lines path-like (no ':'), >=3 lines
	if len(nonEmpty) >= 3 {
		allPathLike := true
		for _, l := range nonEmpty {
			if !isPathLike(l) {
				allPathLike = false
				break
			}
		}
		if allPathLike {
			return findFilter
		}
	}

	// Tree: box-drawing glyphs
	if reTreeGlyph.MatchString(head) {
		return treeFilter
	}

	// ls -la
	if reLSTotal.MatchString(head) || countMatches(head, reLSRow) >= 3 {
		return lsFilter
	}

	// Cursor Glob search list
	if reSearchListHeader.MatchString(head) {
		return searchListFilter
	}

	// Line-numbered file dump
	if len(lines) >= rtkSmartMinLines && isLineNumbered(lines) {
		return readNumberedFilter
	}

	// Fallback: dedupLog
	if len(nonEmpty) >= 5 {
		return dedupLogFilter
	}

	// Last resort: smart truncate
	if strings.Count(text, "\n")+1 >= rtkSmartMinLines {
		return smartTruncateFilter
	}

	return nil
}

// --- Detection regexes ---

var (
	reGitDiff       = regexp.MustCompile(`(?m)^diff --git `)
	reGitDiffHunk   = regexp.MustCompile(`(?m)^@@ `)
	reGitStatus     = regexp.MustCompile(`(?m)^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:`)
	rePorcelain     = regexp.MustCompile(`(?m)^[ MADRCU?!][ MADRCU?!] \S`)
	reBuildOutput   = regexp.MustCompile(`(?im)^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)`)
	reTreeGlyph     = regexp.MustCompile(`[├└]──|│  `)
	reLSRow         = regexp.MustCompile(`(?m)^[-dlbcps][rwx-]{9}`)
	reLSTotal       = regexp.MustCompile(`(?m)^total \d+$`)
	reSearchListHeader = regexp.MustCompile(`^Result of search in '[^']*' \(total (\d+) files?\):`)
	reReadNumberedLine = regexp.MustCompile(`^\s*\d+\|`)
)

func isGrepLine(line string) bool {
	first := strings.IndexByte(line, ':')
	if first == -1 {
		return false
	}
	second := strings.IndexByte(line[first+1:], ':')
	if second == -1 {
		return false
	}
	lineno := line[first+1 : first+1+second]
	_, err := strconv.Atoi(lineno)
	return err == nil
}

func isPathLike(line string) bool {
	t := strings.TrimSpace(line)
	if t == "" {
		return false
	}
	if strings.Contains(t, ":") {
		return false
	}
	return strings.HasPrefix(t, ".") || strings.HasPrefix(t, "/") || strings.Contains(t, "/")
}

func isMostlyPorcelain(head string) bool {
	lines := strings.Split(head, "\n")
	var nonBlank []string
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			nonBlank = append(nonBlank, l)
		}
	}
	if len(nonBlank) < 3 {
		return false
	}
	hits := 0
	for _, l := range nonBlank {
		if rePorcelain.MatchString(l) {
			hits++
		}
	}
	return float64(hits)/float64(len(nonBlank)) >= 0.6
}

func isLineNumbered(lines []string) bool {
	hits := 0
	nonEmpty := 0
	sample := lines
	if len(sample) > 100 {
		sample = sample[:100]
	}
	for _, l := range sample {
		if l == "" {
			continue
		}
		nonEmpty++
		if reReadNumberedLine.MatchString(l) {
			hits++
		}
	}
	if nonEmpty < 5 {
		return false
	}
	return float64(hits)/float64(nonEmpty) >= rtkReadNumberedMinRatio
}

func countMatches(text string, re *regexp.Regexp) int {
	return len(re.FindAllString(text, -1))
}

// --- Filters ---

// gitDiffFilter compacts unified diffs: file headers, per-hunk 100-line cap, +/- counting.
func gitDiffFilter(input string) string {
	return gitDiff(input, 500)
}

func gitDiff(diff string, maxLines int) string {
	var result []string
	currentFile := ""
	added := 0
	removed := 0
	inHunk := false
	hunkShown := 0
	hunkSkipped := 0
	wasTruncated := false
	maxHunkLines := rtkGitDiffHunkMaxLines

	lines := strings.Split(diff, "\n")

	for _, line := range lines {
		if strings.HasPrefix(line, "diff --git") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			if currentFile != "" && (added > 0 || removed > 0) {
				result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
			}
			parts := strings.SplitN(line, " b/", 2)
			if len(parts) > 1 {
				currentFile = parts[1]
			} else {
				currentFile = "unknown"
			}
			result = append(result, "\n"+currentFile)
			added = 0
			removed = 0
			inHunk = false
			hunkShown = 0
		} else if strings.HasPrefix(line, "@@") {
			if hunkSkipped > 0 {
				result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
				wasTruncated = true
				hunkSkipped = 0
			}
			inHunk = true
			hunkShown = 0
			result = append(result, "  "+line)
		} else if inHunk {
			if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
				added++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
				removed++
				if hunkShown < maxHunkLines {
					result = append(result, "  "+line)
					hunkShown++
				} else {
					hunkSkipped++
				}
			} else if hunkShown < maxHunkLines && !strings.HasPrefix(line, "\\") {
				result = append(result, "  "+line)
				hunkShown++
			}
		}

		if len(result) >= maxLines {
			result = append(result, "\n... (more changes truncated)")
			wasTruncated = true
			break
		}
	}

	if hunkSkipped > 0 {
		result = append(result, fmt.Sprintf("  ... (%d lines truncated)", hunkSkipped))
		wasTruncated = true
	}
	if currentFile != "" && (added > 0 || removed > 0) {
		result = append(result, fmt.Sprintf("  +%d -%d", added, removed))
	}
	if wasTruncated {
		result = append(result, "[full diff: rtk git diff --no-compact]")
	}
	return strings.Join(result, "\n")
}

// gitStatusFilter parses git status output into a compact summary.
func gitStatusFilter(input string) string {
	return gitStatus(input)
}

func gitStatus(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 || (len(lines) == 1 && strings.TrimSpace(lines[0]) == "") {
		return "Clean working tree"
	}

	branch := ""
	var stagedFiles, modifiedFiles, untrackedFiles []string
	staged := 0
	modified := 0
	untracked := 0
	conflicts := 0

	for _, raw := range lines {
		if strings.TrimSpace(raw) == "" {
			continue
		}

		// Long-form branch
		if m := reBranchLong.FindStringSubmatch(raw); m != nil {
			branch = m[1]
			continue
		}
		// Porcelain branch header
		if strings.HasPrefix(raw, "##") {
			branch = strings.TrimPrefix(raw, "##")
			branch = strings.TrimSpace(branch)
			continue
		}
		// Porcelain status
		if len(raw) >= 3 && rePorcelain.MatchString(raw) {
			x := raw[0]
			y := raw[1]
			file := raw[3:]

			if raw[:2] == "??" {
				untracked++
				untrackedFiles = append(untrackedFiles, file)
				continue
			}
			if strings.ContainsRune("MADRC", rune(x)) {
				staged++
				stagedFiles = append(stagedFiles, file)
			} else if x == 'U' {
				conflicts++
			}
			if y == 'M' || y == 'D' {
				modified++
				modifiedFiles = append(modifiedFiles, file)
			}
			continue
		}
		// Long form
		if m := reLongForm.FindStringSubmatch(raw); m != nil {
			kind := m[1]
			path := strings.TrimSpace(m[2])
			switch kind {
			case "both modified":
				conflicts++
			case "modified", "deleted":
				modified++
				modifiedFiles = append(modifiedFiles, path)
			case "new file", "renamed":
				staged++
				stagedFiles = append(stagedFiles, path)
			}
			continue
		}
	}

	var out strings.Builder
	if branch != "" {
		out.WriteString("* " + branch + "\n")
	}
	if staged > 0 {
		fmt.Fprintf(&out, "+ Staged: %d files\n", staged)
		for _, f := range sliceHead(stagedFiles, rtkStatusMaxFiles) {
			out.WriteString("   " + f + "\n")
		}
		if len(stagedFiles) > rtkStatusMaxFiles {
			fmt.Fprintf(&out, "   ... +%d more\n", len(stagedFiles)-rtkStatusMaxFiles)
		}
	}
	if modified > 0 {
		fmt.Fprintf(&out, "~ Modified: %d files\n", modified)
		for _, f := range sliceHead(modifiedFiles, rtkStatusMaxFiles) {
			out.WriteString("   " + f + "\n")
		}
		if len(modifiedFiles) > rtkStatusMaxFiles {
			fmt.Fprintf(&out, "   ... +%d more\n", len(modifiedFiles)-rtkStatusMaxFiles)
		}
	}
	if untracked > 0 {
		fmt.Fprintf(&out, "? Untracked: %d files\n", untracked)
		for _, f := range sliceHead(untrackedFiles, rtkStatusMaxUntracked) {
			out.WriteString("   " + f + "\n")
		}
		if len(untrackedFiles) > rtkStatusMaxUntracked {
			fmt.Fprintf(&out, "   ... +%d more\n", len(untrackedFiles)-rtkStatusMaxUntracked)
		}
	}
	if conflicts > 0 {
		fmt.Fprintf(&out, "conflicts: %d files\n", conflicts)
	}
	if staged == 0 && modified == 0 && untracked == 0 && conflicts == 0 {
		out.WriteString("clean — nothing to commit\n")
	}
	return strings.TrimRight(out.String(), "\n")
}

var (
	reBranchLong = regexp.MustCompile(`^On branch (\S+)`)
	reLongForm   = regexp.MustCompile(`^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$`)
)

// buildOutputFilter compresses build tool output (npm, cargo, pip, etc).
func buildOutputFilter(input string) string {
	return buildOutput(input)
}

func buildOutput(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}

	var errors, warnings, deprecations []string
	var summary string
	compilingCount := 0
	downloadingCount := 0

	reCargoErrCont := regexp.MustCompile(`^\s*(-->|\||\d+\s*\||=)`)
	const deprecationKeep = 3
	inCargoError := false   // true when inside multi-line error block
	inCargoWarn := false    // true when inside multi-line warning block
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if inCargoError || inCargoWarn {
			if trimmed == "" {
				inCargoError = false
				inCargoWarn = false
				continue
			}
			if reCargoErrCont.MatchString(line) {
				if inCargoError {
					errors = append(errors, line)
				} else {
					warnings = append(warnings, line)
				}
				continue
			}
			inCargoError = false
			inCargoWarn = false
		}

		if trimmed == "" {
			continue
		}

		switch {
		case reNpmErr.MatchString(trimmed), reYarnErr.MatchString(trimmed):
			errors = append(errors, line)
		case reNpmDeprec.MatchString(trimmed):
			deprecations = append(deprecations, line)
		case reNpmWarn.MatchString(trimmed), reYarnWarn.MatchString(trimmed):
			warnings = append(warnings, line)
		case reErrorStart.MatchString(trimmed), strings.HasPrefix(trimmed, "error -->"):
			errors = append(errors, line)
			inCargoError = true
		case reWarningStart.MatchString(trimmed), strings.HasPrefix(trimmed, "warning -->"):
			warnings = append(warnings, line)
			inCargoWarn = true
		case reErrColon.MatchString(trimmed):
			errors = append(errors, line)
		case reBracketErr.MatchString(trimmed), strings.HasPrefix(trimmed, "BUILD FAILED"):
			errors = append(errors, line)
		case reBracketWarn.MatchString(trimmed):
			warnings = append(warnings, line)
		case reCompiling.MatchString(trimmed):
			compilingCount++
		case reDownloading.MatchString(trimmed), reFetching.MatchString(trimmed):
			downloadingCount++
		case isBuildSummary(trimmed):
			if summary != "" {
				summary += "\n" + line
			} else {
				summary = line
			}
		}
	}

	var out strings.Builder

	keepDep := deprecations
	if len(keepDep) > deprecationKeep {
		keepDep = keepDep[:deprecationKeep]
	}
	for _, d := range keepDep {
		out.WriteString(d + "\n")
	}
	if len(deprecations) > deprecationKeep {
		fmt.Fprintf(&out, "... +%d more deprecated packages\n", len(deprecations)-deprecationKeep)
	}

	if compilingCount > 0 {
		fmt.Fprintf(&out, "Compiled %d packages\n", compilingCount)
	}
	if downloadingCount > 0 {
		fmt.Fprintf(&out, "Downloaded %d packages\n", downloadingCount)
	}

	for _, e := range errors {
		out.WriteString(e + "\n")
	}

	keepWarn := warnings
	if len(keepWarn) > 5 {
		keepWarn = keepWarn[:5]
	}
	for _, w := range keepWarn {
		out.WriteString(w + "\n")
	}
	if len(warnings) > 5 {
		fmt.Fprintf(&out, "... +%d more warnings\n", len(warnings)-5)
	}

	if summary != "" {
		out.WriteString(summary + "\n")
	}

	result := strings.TrimRight(out.String(), "\n")
	if result == "" {
		return input
	}
	return result
}

var (
	reNpmErr      = regexp.MustCompile(`(?i)^npm (ERR!|error)`)
	reYarnErr     = regexp.MustCompile(`(?i)^yarn error`)
	reNpmDeprec   = regexp.MustCompile(`(?i)^npm warn deprecated`)
	reNpmWarn     = regexp.MustCompile(`(?i)^npm warn`)
	reYarnWarn    = regexp.MustCompile(`(?i)^yarn warn`)
	reErrorStart  = regexp.MustCompile(`(?i)^error(\[|:)`)
	reWarningStart = regexp.MustCompile(`(?i)^warning(\[|:)`)
	reErrColon    = regexp.MustCompile(`(?i)^ERROR:`)
	reBracketErr  = regexp.MustCompile(`(?i)^\[ERROR\]`)
	reBracketWarn = regexp.MustCompile(`(?i)^\[WARNING\]`)
	reCompiling   = regexp.MustCompile(`(?i)^\s*Compiling\s+\S+`)
	reDownloading = regexp.MustCompile(`(?i)^\s*Downloading\s+\S+`)
	reFetching    = regexp.MustCompile(`(?i)^Fetching\s+`)
	reBuildSummary = regexp.MustCompile(`(?i)^(added|removed|changed|audited|installed)\s+\d+\s+package|^\s*Finished\s+|^BUILD SUCCESS|^\d+\s+(vulnerabilities|packages?|warnings?|errors?)|^Successfully (installed|built)|^To address .* issues|^Run ` + "`" + `npm (audit|fund)` + "`" + `|packages are looking for funding`)
)

func isBuildSummary(trimmed string) bool {
	return reBuildSummary.MatchString(trimmed)
}

// grepFilter reformats "file:lineno:content" grep output.
func grepFilter(input string) string {
	byFile := make(map[string][][2]string)
	total := 0

	for _, line := range strings.Split(input, "\n") {
		first := strings.IndexByte(line, ':')
		if first == -1 {
			continue
		}
		second := strings.IndexByte(line[first+1:], ':')
		if second == -1 {
			continue
		}
		file := line[:first]
		lineNumStr := line[first+1 : first+1+second]
		content := line[first+1+second+1:]
		if _, err := strconv.Atoi(lineNumStr); err != nil {
			continue
		}
		total++
		byFile[file] = append(byFile[file], [2]string{lineNumStr, content})
	}

	if total == 0 {
		return input
	}

	files := make([]string, 0, len(byFile))
	for f := range byFile {
		files = append(files, f)
	}
	sort.Strings(files)

	var out strings.Builder
	fmt.Fprintf(&out, "%d matches in %dF:\n\n", total, len(files))

	for _, file := range files {
		matches := byFile[file]
		fmt.Fprintf(&out, "[file] %s (%d):\n", file, len(matches))
		show := matches
		if len(show) > rtkGrepPerFileMax {
			show = show[:rtkGrepPerFileMax]
		}
		for _, m := range show {
			out.WriteString("  " + padLeft(m[0], 4) + ": " + strings.TrimSpace(m[1]) + "\n")
		}
		if len(matches) > rtkGrepPerFileMax {
			fmt.Fprintf(&out, "  +%d\n", len(matches)-rtkGrepPerFileMax)
		}
		out.WriteString("\n")
	}
	return out.String()
}

// findFilter groups find output by parent dir, shows basenames.
func findFilter(input string) string {
	var lines []string
	for _, l := range strings.Split(input, "\n") {
		if strings.TrimSpace(l) != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) == 0 {
		return input
	}

	byDir := make(map[string][]string)
	for _, path := range lines {
		lastSlash := strings.LastIndexByte(path, '/')
		var dir, basename string
		if lastSlash == -1 {
			dir = "."
			basename = path
		} else {
			dir = path[:lastSlash]
			if dir == "" {
				dir = "/"
			}
			basename = path[lastSlash+1:]
		}
		byDir[dir] = append(byDir[dir], basename)
	}

	dirs := make([]string, 0, len(byDir))
	for d := range byDir {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)

	var out strings.Builder
	fmt.Fprintf(&out, "%d files in %d dirs:\n\n", len(lines), len(dirs))

	showDirs := dirs
	if len(showDirs) > rtkFindTotalDirMax {
		showDirs = showDirs[:rtkFindTotalDirMax]
	}
	for _, dir := range showDirs {
		files := byDir[dir]
		fmt.Fprintf(&out, "%s/  (%d)\n", dir, len(files))
		showFiles := files
		if len(showFiles) > rtkFindPerDirMax {
			showFiles = showFiles[:rtkFindPerDirMax]
		}
		for _, f := range showFiles {
			out.WriteString("  " + f + "\n")
		}
		if len(files) > rtkFindPerDirMax {
			fmt.Fprintf(&out, "  +%d\n", len(files)-rtkFindPerDirMax)
		}
	}
	if len(dirs) > rtkFindTotalDirMax {
		fmt.Fprintf(&out, "\n+%d more dirs\n", len(dirs)-rtkFindTotalDirMax)
	}
	return out.String()
}

// treeFilter removes summary line and caps at 200 lines.
func treeFilter(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}

	var filtered []string
	for _, line := range lines {
		if strings.Contains(line, "director") && strings.Contains(line, "file") {
			continue
		}
		if strings.TrimSpace(line) == "" && len(filtered) == 0 {
			continue
		}
		filtered = append(filtered, line)
	}
	// Trim trailing blanks
	for len(filtered) > 0 && strings.TrimSpace(filtered[len(filtered)-1]) == "" {
		filtered = filtered[:len(filtered)-1]
	}

	if len(filtered) > rtkTreeMaxLines {
		cut := len(filtered) - rtkTreeMaxLines
		return strings.Join(filtered[:rtkTreeMaxLines], "\n") + fmt.Sprintf("\n... +%d more lines", cut)
	}
	return strings.Join(filtered, "\n")
}

// lsFilter compacts `ls -la` output into dirs/files listing with summary.
func lsFilter(input string) string {
	var dirs []string
	var files [][2]string // [name, sizeStr]
	byExt := make(map[string]int)

	reLsDate := regexp.MustCompile(`\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+`)

	for _, line := range strings.Split(input, "\n") {
		if strings.HasPrefix(line, "total ") || line == "" {
			continue
		}
		m := reLsDate.FindStringIndex(line)
		if m == nil {
			continue
		}
		name := line[m[1]:]
		beforeDate := line[:m[0]]
		beforeParts := strings.Fields(beforeDate)
		if len(beforeParts) < 4 {
			continue
		}
		perms := beforeParts[0]
		fileType := perms[0]

		// size = rightmost parseable int
		size := 0
		for i := len(beforeParts) - 1; i >= 0; i-- {
			if n, err := strconv.Atoi(beforeParts[i]); err == nil {
				size = n
				break
			}
		}

		if name == "." || name == ".." {
			continue
		}
		if lsNoiseDirs[name] {
			continue
		}

		if fileType == 'd' {
			dirs = append(dirs, name)
		} else if fileType == '-' || fileType == 'l' {
			dot := strings.LastIndexByte(name, '.')
			ext := "no ext"
			if dot > 0 {
				ext = name[dot:]
			}
			byExt[ext]++
			files = append(files, [2]string{name, humanSize(size)})
		}
	}

	if len(dirs) == 0 && len(files) == 0 {
		return input
	}

	var out strings.Builder
	for _, d := range dirs {
		out.WriteString(d + "/\n")
	}
	for _, f := range files {
		out.WriteString(f[0] + "  " + f[1] + "\n")
	}

	// Summary
	fmt.Fprintf(&out, "\nSummary: %d files, %d dirs", len(files), len(dirs))
	if len(byExt) > 0 {
		type extCount struct {
			ext  string
			cnt  int
		}
		var ecs []extCount
		for e, c := range byExt {
			ecs = append(ecs, extCount{e, c})
		}
		sort.Slice(ecs, func(i, j int) bool { return ecs[i].cnt > ecs[j].cnt })
		out.WriteString(" (")
		top := ecs
		if len(top) > rtkLSExtSummaryTop {
			top = top[:rtkLSExtSummaryTop]
		}
		for i, ec := range top {
			if i > 0 {
				out.WriteString(", ")
			}
			fmt.Fprintf(&out, "%d %s", ec.cnt, ec.ext)
		}
		if len(ecs) > rtkLSExtSummaryTop {
			fmt.Fprintf(&out, ", +%d more", len(ecs)-rtkLSExtSummaryTop)
		}
		out.WriteString(")")
	}
	return out.String()
}

// dedupLogFilter collapses consecutive duplicate lines + blank-line dedupe + hard cap.
func dedupLogFilter(input string) string {
	lines := strings.Split(input, "\n")
	var out []string
	var prev *string
	runCount := 0
	blankStreak := 0

	flushRun := func() {
		if prev != nil && runCount > 1 {
			out = append(out, fmt.Sprintf("  ... (%d duplicate lines)", runCount-1))
		}
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			if blankStreak < 1 {
				out = append(out, line)
			}
			blankStreak++
			flushRun()
			prev = nil
			runCount = 0
			continue
		}
		blankStreak = 0
		if prev != nil && line == *prev {
			runCount++
			continue
		}
		flushRun()
		out = append(out, line)
		l := line
		prev = &l
		runCount = 1
		if len(out) >= rtkDedupLineMax {
			out = append(out, fmt.Sprintf("... (truncated at %d lines)", rtkDedupLineMax))
			return strings.Join(out, "\n")
		}
	}
	flushRun()
	return strings.Join(out, "\n")
}

// searchListFilter compacts Cursor Glob "Result of search" lists.
func searchListFilter(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) == 0 {
		return input
	}

	header := lines[0]
	rest := lines[1:]

	var paths []string
	for _, raw := range rest {
		t := strings.TrimSpace(raw)
		if !strings.HasPrefix(t, "- ") {
			continue
		}
		paths = append(paths, t[2:])
	}
	if len(paths) == 0 {
		return input
	}

	byDir := make(map[string][]string)
	for _, p := range paths {
		slash := strings.LastIndexByte(p, '/')
		var dir, name string
		if slash == -1 {
			dir = "."
			name = p
		} else {
			dir = p[:slash]
			if dir == "" {
				dir = "/"
			}
			name = p[slash+1:]
		}
		byDir[dir] = append(byDir[dir], name)
	}

	dirs := make([]string, 0, len(byDir))
	for d := range byDir {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)

	var out strings.Builder
	fmt.Fprintf(&out, "%s\n%d files in %d dirs:\n\n", header, len(paths), len(dirs))

	showDirs := dirs
	if len(showDirs) > rtkSearchListTotalDirMax {
		showDirs = showDirs[:rtkSearchListTotalDirMax]
	}
	for _, dir := range showDirs {
		names := byDir[dir]
		fmt.Fprintf(&out, "%s/ (%d):\n", dir, len(names))
		showNames := names
		if len(showNames) > rtkSearchListPerDirMax {
			showNames = showNames[:rtkSearchListPerDirMax]
		}
		for _, n := range showNames {
			out.WriteString("  " + n + "\n")
		}
		if len(names) > rtkSearchListPerDirMax {
			fmt.Fprintf(&out, "  +%d\n", len(names)-rtkSearchListPerDirMax)
		}
		out.WriteString("\n")
	}
	if len(dirs) > rtkSearchListTotalDirMax {
		fmt.Fprintf(&out, "+%d more dirs\n", len(dirs)-rtkSearchListTotalDirMax)
	}
	return strings.TrimRight(out.String(), "\n")
}

// readNumberedFilter handles "N|content" file dumps with head+tail truncation.
func readNumberedFilter(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) < rtkSmartMinLines {
		return input
	}
	head := lines[:rtkSmartHead]
	tail := lines[len(lines)-rtkSmartTail:]
	cut := len(lines) - len(head) - len(tail)
	result := make([]string, 0, len(head)+1+len(tail))
	result = append(result, head...)
	result = append(result, fmt.Sprintf("... +%d lines truncated (file continues)", cut))
	result = append(result, tail...)
	return strings.Join(result, "\n")
}

// smartTruncateFilter keeps HEAD + TAIL lines, replaces middle with truncation marker.
func smartTruncateFilter(input string) string {
	lines := strings.Split(input, "\n")
	if len(lines) < rtkSmartMinLines {
		return input
	}
	head := lines[:rtkSmartHead]
	tail := lines[len(lines)-rtkSmartTail:]
	cut := len(lines) - rtkSmartHead - rtkSmartTail
	result := make([]string, 0, len(head)+1+len(tail))
	result = append(result, head...)
	result = append(result, fmt.Sprintf("... +%d lines truncated", cut))
	result = append(result, tail...)
	return strings.Join(result, "\n")
}

// --- helpers ---

func sliceHead(s []string, n int) []string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func padLeft(s string, width int) string {
	if len(s) >= width {
		return s
	}
	return strings.Repeat(" ", width-len(s)) + s
}

func humanSize(bytes int) string {
	if bytes >= 1048576 {
		return fmt.Sprintf("%.1fM", float64(bytes)/1048576)
	}
	if bytes >= 1024 {
		return fmt.Sprintf("%.1fK", float64(bytes)/1024)
	}
	return fmt.Sprintf("%dB", bytes)
}
