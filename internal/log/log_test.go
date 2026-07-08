package log

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStack(t *testing.T) {
	stack := Stack()
	assert.NotEmpty(t, stack, "Stack() should return non-empty string")
	assert.Contains(t, stack, "goroutine", "Stack trace should contain 'goroutine'")
	assert.Contains(t, stack, "log.TestStack", "Stack trace should contain test function name")
}

func TestNew(t *testing.T) {
	tests := []struct {
		name      string
		level     string
		wantErr   bool
		wantLevel slog.Level
	}{
		{
			name:      "debug level",
			level:     "debug",
			wantErr:   false,
			wantLevel: slog.LevelDebug,
		},
		{
			name:      "info level",
			level:     "info",
			wantErr:   false,
			wantLevel: slog.LevelInfo,
		},
		{
			name:      "warn level",
			level:     "warn",
			wantErr:   false,
			wantLevel: slog.LevelWarn,
		},
		{
			name:      "warning level",
			level:     "warning",
			wantErr:   false,
			wantLevel: slog.LevelWarn,
		},
		{
			name:      "error level",
			level:     "error",
			wantErr:   false,
			wantLevel: slog.LevelError,
		},
		{
			name:      "DEBUG uppercase",
			level:     "DEBUG",
			wantErr:   false,
			wantLevel: slog.LevelDebug,
		},
		{
			name:      "Info mixed case",
			level:     "Info",
			wantErr:   false,
			wantLevel: slog.LevelInfo,
		},
		{
			name:    "invalid level",
			level:   "invalid",
			wantErr: true,
		},
		{
			name:    "empty level",
			level:   "",
			wantErr: true,
		},
		{
			name:    "trace level (not supported)",
			level:   "trace",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger, err := New(tt.level)

			if tt.wantErr {
				require.Error(t, err)
				assert.Nil(t, logger)
				assert.Contains(t, err.Error(), "invalid log level")
				assert.Contains(t, err.Error(), tt.level)
			} else {
				require.NoError(t, err)
				require.NotNil(t, logger)

				// Verify the logger is functional by logging a test message
				var buf bytes.Buffer
				testHandler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: tt.wantLevel})
				testLogger := slog.New(testHandler)

				// Log at the configured level
				switch tt.wantLevel {
				case slog.LevelDebug:
					testLogger.Debug("test message")
				case slog.LevelInfo:
					testLogger.Info("test message")
				case slog.LevelWarn:
					testLogger.Warn("test message")
				case slog.LevelError:
					testLogger.Error("test message")
				}

				output := buf.String()
				assert.Contains(t, output, "test message", "Logger should output the message")
			}
		})
	}
}

func TestNewLoggerOutputFormat(t *testing.T) {
	logger, err := New("info")
	require.NoError(t, err)
	require.NotNil(t, logger)

	// Capture output
	var buf bytes.Buffer
	handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
	testLogger := slog.New(handler)

	testLogger.Info("test message", slog.String("key", "value"))

	output := buf.String()
	assert.NotEmpty(t, output)

	// Verify JSON format
	var logEntry map[string]interface{}
	err = json.Unmarshal([]byte(output), &logEntry)
	require.NoError(t, err, "Output should be valid JSON")

	assert.Equal(t, "test message", logEntry["msg"])
	assert.Equal(t, "value", logEntry["key"])
	assert.Contains(t, logEntry, "time", "JSON log should contain timestamp")
	assert.Contains(t, logEntry, "level", "JSON log should contain level")
}

func TestNewLoggerLevels(t *testing.T) {
	t.Run("debug logger accepts debug messages", func(t *testing.T) {
		_, err := New("debug")
		require.NoError(t, err)

		var buf bytes.Buffer
		handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
		testLogger := slog.New(handler)

		testLogger.Debug("debug message")
		assert.Contains(t, buf.String(), "debug message")
	})

	t.Run("info logger filters debug messages", func(t *testing.T) {
		_, err := New("info")
		require.NoError(t, err)

		var buf bytes.Buffer
		handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})
		testLogger := slog.New(handler)

		testLogger.Debug("debug message")
		assert.Empty(t, buf.String(), "Info logger should filter debug messages")

		testLogger.Info("info message")
		assert.Contains(t, buf.String(), "info message")
	})

	t.Run("warn logger filters info messages", func(t *testing.T) {
		_, err := New("warn")
		require.NoError(t, err)

		var buf bytes.Buffer
		handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})
		testLogger := slog.New(handler)

		testLogger.Info("info message")
		assert.Empty(t, buf.String(), "Warn logger should filter info messages")

		testLogger.Warn("warn message")
		assert.Contains(t, buf.String(), "warn message")
	})

	t.Run("error logger filters warn messages", func(t *testing.T) {
		_, err := New("error")
		require.NoError(t, err)

		var buf bytes.Buffer
		handler := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelError})
		testLogger := slog.New(handler)

		testLogger.Warn("warn message")
		assert.Empty(t, buf.String(), "Error logger should filter warn messages")

		testLogger.Error("error message")
		assert.Contains(t, buf.String(), "error message")
	})
}

func TestNewLoggerCaseInsensitive(t *testing.T) {
	levels := []string{"debug", "DEBUG", "Debug", "DeBuG"}

	for _, level := range levels {
		t.Run(level, func(t *testing.T) {
			logger, err := New(level)
			require.NoError(t, err, "Should accept case-insensitive level: %s", level)
			assert.NotNil(t, logger)
		})
	}
}

func TestNewErrorMessage(t *testing.T) {
	_, err := New("invalid")
	require.Error(t, err)
	
	errMsg := err.Error()
	assert.Contains(t, errMsg, "invalid log level")
	assert.Contains(t, errMsg, "invalid")
	
	// Test with special characters
	_, err = New("level\nwith\nnewlines")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid log level")
}
