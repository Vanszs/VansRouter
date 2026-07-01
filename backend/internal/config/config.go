package config

import (
	"crypto/rand"
	"fmt"
	"path/filepath"
	"strconv"
	"time"

	"github.com/caarlos0/env/v11"
)

// Runtime defaults mirrored from the Node.js backend.
const (
	defaultPort            = 3003
	defaultLogLevel        = "info"
	defaultDashboardURL    = "http://localhost:3000"
	defaultStreamStallMs   = 360 * 1000
	defaultFirstChunkMs    = 200 * 1000
	defaultFetchConnectMs  = 60 * 1000
	defaultComboTargetMs   = 30 * 1000
	defaultMaxTokens       = 64000
	defaultMinTokens       = 32000
	defaultMITMRouterBase  = "http://localhost:20128"
	defaultHeadroomURL     = "http://localhost:8787"
	defaultBackoffBaseMs   = 2000
	defaultBackoffMaxMs    = 5 * 60 * 1000
	defaultTransientCooldown = 30 * 1000
)

// LogLevel is a validated log level string.
type LogLevel string

// Log level constants.
const (
	LogLevelDebug LogLevel = "debug"
	LogLevelInfo  LogLevel = "info"
	LogLevelWarn  LogLevel = "warn"
	LogLevelError LogLevel = "error"
)

// Config holds runtime configuration parsed from environment variables.
type Config struct {
	Port            int      `env:"PORT" envDefault:"3003"`
	DataDir         string   `env:"DATA_DIR" envDefault:""`
	DatabaseFile    string   `env:"DATABASE_FILE" envDefault:"db/data.sqlite"`
	JWTSecret       string   `env:"JWT_SECRET" envDefault:""`
	DashboardURL    string   `env:"NEXT_PUBLIC_BASE_URL" envDefault:"http://localhost:3000"`
	LogLevel        LogLevel `env:"LOG_LEVEL" envDefault:"info"`
	RequireAPIKey   bool     `env:"REQUIRE_API_KEY" envDefault:"false"`
	StreamStallMs   int      `env:"STREAM_STALL_TIMEOUT_MS" envDefault:"360000"`
	FirstChunkMs    int      `env:"STREAM_FIRST_CHUNK_TIMEOUT_MS" envDefault:"200000"`
	FetchConnectMs  int      `env:"FETCH_CONNECT_TIMEOUT_MS" envDefault:"60000"`
	ComboTargetMs   int      `env:"COMBO_TARGET_TIMEOUT_MS" envDefault:"30000"`
	MITMRouterBase  string   `env:"MITM_ROUTER_BASE_URL" envDefault:"http://localhost:20128"`
	HeadroomURL     string   `env:"HEADROOM_URL" envDefault:"http://localhost:8787"`
	MaxTokens       int      `env:"DEFAULT_MAX_TOKENS" envDefault:"64000"`
	MinTokens       int      `env:"DEFAULT_MIN_TOKENS" envDefault:"32000"`
	OutboundProxy   string   `env:"HTTPS_PROXY" envDefault:""`
	OutboundNoProxy string   `env:"NO_PROXY" envDefault:""`
}

// Load parses environment variables into a Config with defaults matching the
// Node.js backend. It also resolves and creates the data directory.
func Load() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, fmt.Errorf("parse env: %w", err)
	}

	// Resolve empty DataDir to the platform default, matching dataDir.js.
	if cfg.DataDir == "" {
		cfg.DataDir = resolveDataDir()
	}

	// Create the data directory tree if it does not exist.
	if err := ensureDir(cfg.DataDir); err != nil {
		return nil, err
	}

	if cfg.JWTSecret == "" {
		// Generate an ephemeral secret so single-process dev mode works.
		// Production should always set JWT_SECRET explicitly.
		cfg.JWTSecret = generateSecret()
	}

	return &cfg, nil
}

// DataDirPath returns the absolute path to the configured data directory.
func (c *Config) DataDirPath() string {
	return c.DataDir
}

// DBPath returns the absolute path to the SQLite database file.
func (c *Config) DBPath() string {
	if filepath.IsAbs(c.DatabaseFile) {
		return c.DatabaseFile
	}
	return filepath.Join(c.DataDir, c.DatabaseFile)
}

// BackupsDir returns the absolute path to database backups.
func (c *Config) BackupsDir() string {
	return filepath.Join(c.DataDir, "db", "backups")
}

// LegacyFiles returns the paths to legacy JSON data files.
func (c *Config) LegacyFiles() map[string]string {
	return map[string]string{
		"main":     filepath.Join(c.DataDir, "db.json"),
		"usage":    filepath.Join(c.DataDir, "usage.json"),
		"disabled": filepath.Join(c.DataDir, "disabledModels.json"),
		"details":  filepath.Join(c.DataDir, "request-details.json"),
	}
}

// EnsureDBDir ensures the database directory exists.
func (c *Config) EnsureDBDir() error {
	return ensureDir(filepath.Dir(c.DBPath()))
}

// StreamStallTimeout returns the stream stall timeout as a time.Duration.
func (c *Config) StreamStallTimeout() time.Duration {
	return time.Duration(c.StreamStallMs) * time.Millisecond
}

// FirstChunkTimeout returns the time-to-first-token timeout.
func (c *Config) FirstChunkTimeout() time.Duration {
	return time.Duration(c.FirstChunkMs) * time.Millisecond
}

// FetchConnectTimeout returns the upstream connect timeout.
func (c *Config) FetchConnectTimeout() time.Duration {
	return time.Duration(c.FetchConnectMs) * time.Millisecond
}

// ComboTargetTimeout returns the combo member timeout.
func (c *Config) ComboTargetTimeout() time.Duration {
	return time.Duration(c.ComboTargetMs) * time.Millisecond
}

// generateSecret creates a short random suffix used as a fallback JWT secret
// in development. It is not cryptographically strong and must not be used in
// production.
func generateSecret() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b) // best-effort; ignore error since this is a dev fallback
	return "dev-" + strconv.FormatInt(time.Now().UnixNano(), 36) + "-" + fmt.Sprintf("%x", b)
}
