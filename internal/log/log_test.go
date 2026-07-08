package log

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct{ level string; ok bool }{
		{"debug", true},
		{"info", true},
		{"warn", true},
		{"warning", true},
		{"error", true},
		{"bogus", false},
	}
	for _, tt := range tests {
		_, err := New(tt.level)
		if tt.ok && err != nil {
			t.Errorf("New(%q) unexpected error: %v", tt.level, err)
		}
		if !tt.ok && err == nil {
			t.Errorf("New(%q) expected error, got nil", tt.level)
		}
	}
}

func TestNew_CaseInsensitive(t *testing.T) {
	_, err := New("DEBUG")
	if err != nil {
		t.Errorf("New(\"DEBUG\") unexpected error: %v", err)
	}
	_, err = New("Info")
	if err != nil {
		t.Errorf("New(\"Info\") unexpected error: %v", err)
	}
}

func TestStack(t *testing.T) {
	s := Stack()
	if s == "" {
		t.Error("Stack() returned empty string")
	}
	if !strings.Contains(s, "goroutine") {
		t.Error("Stack() should contain goroutine info")
	}
}

func TestRequestLogger(t *testing.T) {
	logger, _ := New("info")
	mw := RequestLogger(logger)
	if mw == nil {
		t.Fatal("RequestLogger returned nil")
	}

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusTeapot)
	})

	mw(next).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/test", nil))
	if !called {
		t.Error("next handler not called")
	}
}

func TestRecovery(t *testing.T) {
	logger, _ := New("error")
	mw := Recovery(logger)
	if mw == nil {
		t.Fatal("Recovery returned nil")
	}

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	})

	rec := httptest.NewRecorder()
	mw(next).ServeHTTP(rec, httptest.NewRequest("GET", "/panic", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

func TestRecovery_NoPanic(t *testing.T) {
	logger, _ := New("error")
	mw := Recovery(logger)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	mw(next).ServeHTTP(rec, httptest.NewRequest("GET", "/safe", nil))
	if !called {
		t.Error("next handler not called")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestResponseWriter(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	rw.WriteHeader(http.StatusCreated)
	if rw.statusCode != http.StatusCreated {
		t.Errorf("statusCode = %d, want %d", rw.statusCode, http.StatusCreated)
	}
	if rec.Code != http.StatusCreated {
		t.Errorf("underlying status = %d, want %d", rec.Code, http.StatusCreated)
	}
}
