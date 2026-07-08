package log

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponseWriter_WriteHeader(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	rw.WriteHeader(http.StatusCreated)

	assert.Equal(t, http.StatusCreated, rw.statusCode, "statusCode should be updated")
	assert.Equal(t, http.StatusCreated, rec.Code, "underlying recorder should have the status code")
}

func TestResponseWriter_DefaultStatusCode(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	// Write without calling WriteHeader
	rw.Write([]byte("test"))

	assert.Equal(t, http.StatusOK, rw.statusCode, "default statusCode should remain 200")
}

func TestRequestLogger(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	tests := []struct {
		name           string
		method         string
		path           string
		handlerStatus  int
		expectedMethod string
		expectedPath   string
	}{
		{
			name:           "GET request",
			method:         "GET",
			path:           "/api/users",
			handlerStatus:  http.StatusOK,
			expectedMethod: "GET",
			expectedPath:   "/api/users",
		},
		{
			name:           "POST request",
			method:         "POST",
			path:           "/api/data",
			handlerStatus:  http.StatusCreated,
			expectedMethod: "POST",
			expectedPath:   "/api/data",
		},
		{
			name:           "DELETE request",
			method:         "DELETE",
			path:           "/api/items/123",
			handlerStatus:  http.StatusNoContent,
			expectedMethod: "DELETE",
			expectedPath:   "/api/items/123",
		},
		{
			name:           "error response",
			method:         "GET",
			path:           "/error",
			handlerStatus:  http.StatusInternalServerError,
			expectedMethod: "GET",
			expectedPath:   "/error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf.Reset()

			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.handlerStatus)
				w.Write([]byte("response"))
			})

			middleware := RequestLogger(logger)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()

			wrappedHandler.ServeHTTP(rec, req)

			assert.Equal(t, tt.handlerStatus, rec.Code, "response status should match handler")

			// Parse log output
			output := buf.String()
			require.NotEmpty(t, output, "should produce log output")

			var logEntry map[string]interface{}
			err := json.Unmarshal([]byte(output), &logEntry)
			require.NoError(t, err, "log output should be valid JSON")

			assert.Equal(t, "request", logEntry["msg"], "log message should be 'request'")
			assert.Equal(t, tt.expectedMethod, logEntry["method"], "method should match")
			assert.Equal(t, tt.expectedPath, logEntry["path"], "path should match")
			assert.Equal(t, float64(tt.handlerStatus), logEntry["status"], "status should match")
			assert.Contains(t, logEntry, "duration", "log should contain duration")
		})
	}
}

func TestRequestLogger_WithQueryString(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	middleware := RequestLogger(logger)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/search?q=test&page=1", nil)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	output := buf.String()
	var logEntry map[string]interface{}
	err := json.Unmarshal([]byte(output), &logEntry)
	require.NoError(t, err)

	// Path should not include query string
	assert.Equal(t, "/search", logEntry["path"], "path should not include query string")
}

func TestRecovery_NoPanic(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	middleware := Recovery(logger)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/normal", nil)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "should return handler's status code")
	assert.Equal(t, "success", rec.Body.String(), "should return handler's response")
	assert.Empty(t, buf.String(), "should not log when no panic occurs")
}

func TestRecovery_WithPanic(t *testing.T) {
	tests := []struct {
		name        string
		method      string
		path        string
		panicValue  interface{}
		expectedMsg string
	}{
		{
			name:        "string panic",
			method:      "GET",
			path:        "/panic-string",
			panicValue:  "something went wrong",
			expectedMsg: "something went wrong",
		},
		{
			name:        "error panic",
			method:      "POST",
			path:        "/panic-error",
			panicValue:  http.ErrAbortHandler,
			expectedMsg: "net/http: abort Handler",
		},
		{
			name:        "nil panic",
			method:      "DELETE",
			path:        "/panic-nil",
			panicValue:  nil,
			expectedMsg: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				panic(tt.panicValue)
			})

			middleware := Recovery(logger)
			wrappedHandler := middleware(handler)

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()

			// Should not panic
			assert.NotPanics(t, func() {
				wrappedHandler.ServeHTTP(rec, req)
			}, "middleware should recover from panic")

			assert.Equal(t, http.StatusInternalServerError, rec.Code, "should return 500")
			assert.Contains(t, rec.Body.String(), "Internal Server Error", "should return error message")

			// Parse log output
			output := buf.String()
			require.NotEmpty(t, output, "should log panic")

			var logEntry map[string]interface{}
			err := json.Unmarshal([]byte(output), &logEntry)
			require.NoError(t, err, "log output should be valid JSON")

			assert.Equal(t, "panic recovered", logEntry["msg"], "log message should be 'panic recovered'")
			assert.Equal(t, tt.method, logEntry["method"], "method should match")
			assert.Equal(t, tt.path, logEntry["path"], "path should match")
			assert.Contains(t, logEntry, "error", "log should contain error field")

			if tt.expectedMsg != "" {
				errorStr, ok := logEntry["error"].(string)
				require.True(t, ok, "error field should be a string")
				assert.Contains(t, errorStr, tt.expectedMsg, "error message should contain panic value")
			}
		})
	}
}

func TestRecovery_ResponseAfterPanic(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to write response before panic
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("partial response"))
		panic("oops")
	})

	middleware := Recovery(logger)
	wrappedHandler := middleware(handler)

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	wrappedHandler.ServeHTTP(rec, req)

	// The response was already written before the panic, so we can't override it
	// The middleware should still recover
	assert.NotEmpty(t, buf.String(), "should log panic even if response was partially written")
}

func TestMiddlewareChain(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// Chain: Recovery -> RequestLogger -> Handler
	middleware := Recovery(logger)(RequestLogger(logger)(handler))

	req := httptest.NewRequest("GET", "/chained", nil)
	rec := httptest.NewRecorder()

	middleware.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "ok", rec.Body.String())

	output := buf.String()
	assert.Contains(t, output, "request", "should log request")
}

func TestMiddlewareChain_WithPanic(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo}))

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	})

	// Chain: Recovery -> RequestLogger -> Handler
	middleware := Recovery(logger)(RequestLogger(logger)(handler))

	req := httptest.NewRequest("GET", "/panic", nil)
	rec := httptest.NewRecorder()

	assert.NotPanics(t, func() {
		middleware.ServeHTTP(rec, req)
	}, "should recover from panic")

	assert.Equal(t, http.StatusInternalServerError, rec.Code)

	output := buf.String()
	assert.Contains(t, output, "panic recovered", "should log panic")
}
