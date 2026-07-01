package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

const appName = "9router"

// defaultDataDir returns the platform-specific default data directory.
// On Windows it uses %APPDATA%/<appName> if APPDATA is set, otherwise
// falls back to ~/AppData/Roaming/<appName>. On Unix it returns ~/.<appName>.
func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, appName)
	}
	return filepath.Join(home, "."+appName)
}

// resolveDataDir resolves the configured data directory, mirroring the JS
// dataDir.js behavior. If DATA_DIR is set, it is used directly; otherwise
// the platform default is returned.
func resolveDataDir() string {
	configured := os.Getenv("DATA_DIR")
	if configured == "" {
		return defaultDataDir()
	}

	// On Windows, ignore Unix-style absolute paths that may come from a
	// Linux-targeted .env or Docker config.
	if runtime.GOOS == "windows" && len(configured) > 0 && configured[0] == '/' {
		return defaultDataDir()
	}

	return configured
}

// ensureDir creates dir and all parents with 0755 permissions. It returns
// the input path unchanged on success so it can be used inline.
func ensureDir(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create directory %s: %w", dir, err)
	}
	return nil
}
