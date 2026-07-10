package tokensaver

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAutoDetectFilter_GitDiff(t *testing.T) {
	text := "diff --git a/foo.go b/foo.go\n@@ -1,3 +1,3 @@\n func foo() {\n-  old\n+  new\n }\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "git-diff", FilterName(f))
}

func TestAutoDetectFilter_GitStatus(t *testing.T) {
	text := "On branch main\nChanges not staged for commit:\n\tmodified:   foo.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "git-status", FilterName(f))
}

func TestAutoDetectFilter_BuildOutput(t *testing.T) {
	text := "Compiling foo v1.0.0\nCompiling bar v2.0.0\nFinished release [optimized]\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "build-output", FilterName(f))
}

func TestAutoDetectFilter_Grep(t *testing.T) {
	text := "main.go:42:func main() {\nmain.go:43:\tprintln(\"hello\")\nmain.go:44:}\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "grep", FilterName(f))
}

func TestAutoDetectFilter_Find(t *testing.T) {
	text := "./src/main.go\n./src/util.go\n./src/helper.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "find", FilterName(f))
}

func TestAutoDetectFilter_Tree(t *testing.T) {
	text := "src/\n├── main.go\n├── util.go\n└── helper.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "tree", FilterName(f))
}

func TestAutoDetectFilter_LS(t *testing.T) {
	text := "total 24\n-rw-r--r-- 1 user user  1024 Jul  8 foo.go\n-rw-r--r-- 1 user user  2048 Jul  8 bar.go\n-rw-r--r-- 1 user user   512 Jul  8 baz.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "ls", FilterName(f))
}

func TestAutoDetectFilter_SearchList(t *testing.T) {
	text := "Result of search in '**/*.go' (total 5 files):\n- src/main.go\n- src/util.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "search-list", FilterName(f))
}

func TestAutoDetectFilter_ReadNumbered(t *testing.T) {
	// autodetect uses first 1024 chars; need 250+ numbered lines in that window
	// Each line "N|c" is 4 chars, so max ~256 lines. Use direct filter test.
	var lines []string
	for i := 1; i <= 300; i++ {
		lines = append(lines, itoa(i)+"|c")
	}
	text := strings.Join(lines, "\n")
	result := readNumberedFilter(text)
	assert.Contains(t, result, "lines truncated")
}

func TestAutoDetectFilter_DedupLog(t *testing.T) {
	text := "line1\nline1\nline2\nline3\nline4\nline5\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "dedup-log", FilterName(f))
}

func TestAutoDetectFilter_SmartTruncate(t *testing.T) {
	// 300 unique lines → dedup-log has >=5 non-empty, so it fires first.
	// Test smart-truncate directly.
	var lines []string
	for i := 0; i < 300; i++ {
		lines = append(lines, "unique line "+itoa(i))
	}
	text := strings.Join(lines, "\n")
	result := smartTruncateFilter(text)
	assert.Contains(t, result, "lines truncated")
	assert.Contains(t, result, "unique line 0")
	assert.Contains(t, result, "unique line 299")
}

func TestAutoDetectFilter_NoFilter(t *testing.T) {
	text := "short text"
	f := autoDetectFilter(text)
	assert.Nil(t, f)
}

func TestAutoDetectFilter_Porcelain(t *testing.T) {
	text := " M foo.go\n M bar.go\n?? baz.go\n M qux.go\n"
	f := autoDetectFilter(text)
	require.NotNil(t, f)
	assert.Equal(t, "git-status", FilterName(f))
}

// --- Filter tests ---

func TestGitDiffFilter(t *testing.T) {
	diff := "diff --git a/foo.go b/foo.go\n@@ -1,3 +1,3 @@\n func foo() {\n-old line\n+new line\n }\n"
	result := gitDiffFilter(diff)
	assert.Contains(t, result, "foo.go")
	assert.Contains(t, result, "+1 -1")
	assert.Contains(t, result, "+new line")
	assert.Contains(t, result, "-old line")
}

func TestGitDiffFilter_Truncation(t *testing.T) {
	var lines []string
	lines = append(lines, "diff --git a/big.go b/big.go")
	lines = append(lines, "@@ -1,200 +1,200 @@")
	for i := 0; i < 200; i++ {
		lines = append(lines, "-old"+itoa(i))
		lines = append(lines, "+new"+itoa(i))
	}
	diff := strings.Join(lines, "\n")
	result := gitDiffFilter(diff)
	assert.Contains(t, result, "lines truncated")
}

func TestGitStatusFilter_Long(t *testing.T) {
	input := "On branch main\nChanges not staged for commit:\n	modified:   foo.go\n	modified:   bar.go\n\nUntracked files:\n	baz.go\n\nnothing added to commit\n"
	result := gitStatusFilter(input)
	assert.Contains(t, result, "* main")
	assert.Contains(t, result, "Modified: 2 files")
	assert.Contains(t, result, "foo.go")
}

func TestGitStatusFilter_Porcelain(t *testing.T) {
	input := "## main...origin/main\n M foo.go\nA  bar.go\n?? baz.go\n"
	result := gitStatusFilter(input)
	assert.Contains(t, result, "main")
	assert.Contains(t, result, "Staged: 1")
	assert.Contains(t, result, "bar.go")
	assert.Contains(t, result, "Modified: 1")
	assert.Contains(t, result, "Untracked: 1")
}

func TestGitStatusFilter_Clean(t *testing.T) {
	result := gitStatusFilter("")
	assert.Equal(t, "Clean working tree", result)
}

func TestBuildOutputFilter(t *testing.T) {
	input := "Compiling foo\nCompiling bar\nCompiling baz\nerror[E0308]: mismatched types\n --> src/main.rs:10:5\n  | \n10 |     let x: bool = 5;\n  |                   ^ expected `bool`, found integer\nwarning: unused variable: `x`\nFinished release\n"
	result := buildOutputFilter(input)
	assert.Contains(t, result, "Compiled 3 packages")
	assert.Contains(t, result, "error[E0308]")
	assert.Contains(t, result, "warning: unused variable")
	assert.Contains(t, result, "Finished release")
}

func TestBuildOutputFilter_Npm(t *testing.T) {
	input := "npm warn deprecated foo@1.0.0\nadded 42 packages in 3s\nnpm ERR! code 1\n"
	result := buildOutputFilter(input)
	assert.Contains(t, result, "deprecated")
	assert.Contains(t, result, "added 42 packages")
	assert.Contains(t, result, "npm ERR!")
}

func TestGrepFilter(t *testing.T) {
	input := "main.go:42:func main() {\nmain.go:43:println()\nutil.go:10:func util() {\n"
	result := grepFilter(input)
	assert.Contains(t, result, "3 matches in 2F")
	assert.Contains(t, result, "main.go")
	assert.Contains(t, result, "util.go")
	assert.Contains(t, result, "func main()")
}

func TestGrepFilter_NoMatches(t *testing.T) {
	input := "just some text\nno colons here\n"
	result := grepFilter(input)
	assert.Equal(t, input, result)
}

func TestFindFilter(t *testing.T) {
	input := "./src/main.go\n./src/util.go\n./src/helper.go\n"
	result := findFilter(input)
	assert.Contains(t, result, "3 files in 1 dirs")
	assert.Contains(t, result, "src/")
	assert.Contains(t, result, "main.go")
}

func TestTreeFilter(t *testing.T) {
	input := "src/\n├── main.go\n├── util.go\n└── helper.go\n\n5 directories, 3 files\n"
	result := treeFilter(input)
	assert.NotContains(t, result, "directories")
	assert.NotContains(t, result, "files\n")
	assert.Contains(t, result, "main.go")
}

func TestTreeFilter_Truncation(t *testing.T) {
	var lines []string
	lines = append(lines, "root")
	for i := 0; i < 300; i++ {
		lines = append(lines, "├── file"+itoa(i))
	}
	input := strings.Join(lines, "\n")
	result := treeFilter(input)
	assert.Contains(t, result, "more lines")
}

func TestLSFilter(t *testing.T) {
	input := "total 24\n-rw-r--r-- 1 user user  1024 Jul  8 10:30 foo.go\n-rw-r--r-- 1 user user  2048 Jul  8 10:30 bar.go\ndrwxr-xr-x 2 user user  4096 Jul  8 10:30 src\n"
	result := lsFilter(input)
	assert.Contains(t, result, "src/")
	assert.Contains(t, result, "foo.go")
	assert.Contains(t, result, "bar.go")
	assert.Contains(t, result, "Summary:")
	assert.Contains(t, result, ".go")
}

func TestLSFilter_NoiseDirs(t *testing.T) {
	input := "total 24\ndrwxr-xr-x 2 user user  4096 Jul  8 10:30 node_modules\ndrwxr-xr-x 2 user user  4096 Jul  8 10:30 .git\n-rw-r--r-- 1 user user  1024 Jul  8 10:30 foo.go\n"
	result := lsFilter(input)
	assert.NotContains(t, result, "node_modules")
	assert.NotContains(t, result, ".git")
	assert.Contains(t, result, "foo.go")
}

func TestDedupLogFilter(t *testing.T) {
	input := "line1\nline1\nline1\nline2\nline3\nline3\n"
	result := dedupLogFilter(input)
	assert.Contains(t, result, "duplicate lines")
	assert.Contains(t, result, "line1")
	assert.Contains(t, result, "line2")
	assert.Contains(t, result, "line3")
}

func TestDedupLogFilter_BlankLines(t *testing.T) {
	input := "foo\n\n\n\nbar\n"
	result := dedupLogFilter(input)
	assert.Contains(t, result, "foo")
	assert.Contains(t, result, "bar")
	lines := strings.Split(result, "\n")
	maxConsecutiveBlanks := 0
	current := 0
	for _, l := range lines {
		if l == "" {
			current++
			if current > maxConsecutiveBlanks {
				maxConsecutiveBlanks = current
			}
		} else {
			current = 0
		}
	}
	assert.LessOrEqual(t, maxConsecutiveBlanks, 1)
}

func TestDedupLogFilter_Truncation(t *testing.T) {
	var lines []string
	for i := 0; i < 3000; i++ {
		lines = append(lines, "unique"+itoa(i))
	}
	input := strings.Join(lines, "\n")
	result := dedupLogFilter(input)
	assert.Contains(t, result, "truncated at")
}

func TestSearchListFilter(t *testing.T) {
	input := "Result of search in '**/*.go' (total 3 files):\n- src/main.go\n- src/util.go\n- src/helper.go\n"
	result := searchListFilter(input)
	assert.Contains(t, result, "3 files in 1 dirs")
	assert.Contains(t, result, "src/")
	assert.Contains(t, result, "main.go")
}

func TestSearchListFilter_NoPaths(t *testing.T) {
	input := "Result of search in '**/*.go' (total 0 files):\n"
	result := searchListFilter(input)
	assert.Equal(t, input, result)
}

func TestReadNumberedFilter(t *testing.T) {
	var lines []string
	for i := 1; i <= 300; i++ {
		lines = append(lines, "  "+itoa(i)+"|content")
	}
	input := strings.Join(lines, "\n")
	result := readNumberedFilter(input)
	assert.Contains(t, result, "lines truncated")
	// Should keep first 120 and last 60 lines
	assert.Contains(t, result, "  1|content")
	assert.Contains(t, result, "  300|content")
}

func TestReadNumberedFilter_ShortInput(t *testing.T) {
	input := "  1|foo\n  2|bar\n"
	result := readNumberedFilter(input)
	assert.Equal(t, input, result) // too short to truncate
}

func TestSmartTruncateFilter(t *testing.T) {
	var lines []string
	for i := 0; i < 300; i++ {
		lines = append(lines, "line "+itoa(i))
	}
	input := strings.Join(lines, "\n")
	result := smartTruncateFilter(input)
	assert.Contains(t, result, "lines truncated")
	assert.Contains(t, result, "line 0")   // head
	assert.Contains(t, result, "line 299") // tail
}

func TestSmartTruncateFilter_ShortInput(t *testing.T) {
	input := "short\ntext\n"
	result := smartTruncateFilter(input)
	assert.Equal(t, input, result)
}

func TestFilterName_Unknown(t *testing.T) {
	custom := func(s string) string { return s }
	assert.Equal(t, "unknown", FilterName(custom))
}

func TestHumanSize(t *testing.T) {
	assert.Equal(t, "512B", humanSize(512))
	assert.Equal(t, "1.0K", humanSize(1024))
	assert.Equal(t, "1.0M", humanSize(1048576))
}

// --- Integration tests ---

func TestCompressMessages_GitDiff(t *testing.T) {
	// Build a large enough diff that compression actually reduces size
	var lines []string
	lines = append(lines, "diff --git a/big.go b/big.go")
	lines = append(lines, "@@ -1,100 +1,100 @@")
	for i := 0; i < 100; i++ {
		lines = append(lines, "-old line "+itoa(i))
		lines = append(lines, "+new line "+itoa(i))
	}
	diff := strings.Join(lines, "\n")
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "tool", "content": diff},
		},
	}
	stats := CompressMessages(body, true)
	require.NotNil(t, stats)
	assert.Greater(t, stats.BytesBefore, stats.BytesAfter)
	assert.Contains(t, stats.Hits, "openai-tool")
}

func TestCompressMessages_GrepOutput(t *testing.T) {
	var lines []string
	for i := 0; i < 20; i++ {
		lines = append(lines, "main.go:"+itoa(i*10)+":func test"+itoa(i)+"() {")
	}
	grepOutput := strings.Join(lines, "\n")
	// Pad to exceed minCompressSize
	grepOutput += strings.Repeat("\nmain.go:999:padding", 30)
	body := map[string]any{
		"messages": []any{
			map[string]any{"role": "tool", "content": grepOutput},
		},
	}
	stats := CompressMessages(body, true)
	require.NotNil(t, stats)
	assert.Greater(t, stats.BytesBefore, stats.BytesAfter)
}

// itoa is a simple int→string to avoid strconv import in test
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
