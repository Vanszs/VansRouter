package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)

	cfg, err := Load()
	require.NoError(t, err)
	require.NotNil(t, cfg)

	assert.Equal(t, defaultPort, cfg.Port)
	assert.Equal(t, defaultLogLevel, string(cfg.LogLevel))
	assert.Equal(t, defaultDashboardURL, cfg.DashboardURL)
	assert.Equal(t, defaultStreamStallMs, cfg.StreamStallMs)
	assert.Equal(t, defaultFirstChunkMs, cfg.FirstChunkMs)
	assert.Equal(t, defaultFetchConnectMs, cfg.FetchConnectMs)
	assert.Equal(t, defaultComboTargetMs, cfg.ComboTargetMs)
	assert.Equal(t, defaultMITMRouterBase, cfg.MITMRouterBase)
	assert.Equal(t, defaultHeadroomURL, cfg.HeadroomURL)
	assert.Equal(t, defaultMaxTokens, cfg.MaxTokens)
	assert.Equal(t, defaultMinTokens, cfg.MinTokens)
	assert.False(t, cfg.RequireAPIKey)
	assert.NotEmpty(t, cfg.JWTSecret)
	assert.Equal(t, dir, cfg.DataDir)

	dbPath := cfg.DBPath()
	assert.True(t, filepath.IsAbs(dbPath))
	assert.Equal(t, filepath.Join(dir, "db", "data.sqlite"), dbPath)

	assert.DirExists(t, dir)
}

func TestLoadEnvOverrides(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	t.Setenv("PORT", "8080")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("REQUIRE_API_KEY", "true")
	t.Setenv("JWT_SECRET", "super-secret")
	t.Setenv("NEXT_PUBLIC_BASE_URL", "http://example.com")
	t.Setenv("STREAM_STALL_TIMEOUT_MS", "1000")
	t.Setenv("DATABASE_FILE", "custom.db")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, 8080, cfg.Port)
	assert.Equal(t, "debug", string(cfg.LogLevel))
	assert.True(t, cfg.RequireAPIKey)
	assert.Equal(t, "super-secret", cfg.JWTSecret)
	assert.Equal(t, "http://example.com", cfg.DashboardURL)
	assert.Equal(t, 1000, cfg.StreamStallMs)
	assert.Equal(t, filepath.Join(dir, "custom.db"), cfg.DBPath())
}

func TestLoadCreatesDataDir(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "a", "b", "c")
	t.Setenv("DATA_DIR", nested)

	cfg, err := Load()
	require.NoError(t, err)
	assert.Equal(t, nested, cfg.DataDir)
	assert.DirExists(t, nested)
}

func TestDefaultDataDir(t *testing.T) {
	home, err := os.UserHomeDir()
	require.NoError(t, err)

	// Ensure DATA_DIR is unset.
	t.Setenv("DATA_DIR", "")
	cfg, err := Load()
	require.NoError(t, err)

	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		assert.Equal(t, filepath.Join(appData, appName), cfg.DataDir)
	} else {
		assert.Equal(t, filepath.Join(home, "."+appName), cfg.DataDir)
	}
}

func TestLegacyFiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	cfg, err := Load()
	require.NoError(t, err)

	legacy := cfg.LegacyFiles()
	assert.Equal(t, filepath.Join(dir, "db.json"), legacy["main"])
	assert.Equal(t, filepath.Join(dir, "usage.json"), legacy["usage"])
	assert.Equal(t, filepath.Join(dir, "disabledModels.json"), legacy["disabled"])
	assert.Equal(t, filepath.Join(dir, "request-details.json"), legacy["details"])
}

func TestEnsureDBDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DATA_DIR", dir)
	cfg, err := Load()
	require.NoError(t, err)

	require.NoError(t, cfg.EnsureDBDir())
	assert.DirExists(t, filepath.Dir(cfg.DBPath()))
}
