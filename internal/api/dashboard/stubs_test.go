package dashboard

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/9router/9router/internal/models"
)

// stubSource implements models.Source for testing.
type stubSource struct {
	snap *models.SourceSnapshot
	err  error
}

func (s *stubSource) Snapshot(context.Context) (*models.SourceSnapshot, error) {
	return s.snap, s.err
}

func TestModelsList_NilBuilder_ReturnsEmpty(t *testing.T) {
	h := NewStubsHandlers(nil, nil)
	req := httptest.NewRequest("GET", "/api/models", nil)
	rec := httptest.NewRecorder()
	h.ModelsList(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	modelsList, ok := body["models"].([]any)
	if !ok {
		t.Fatal("expected 'models' array in response")
	}
	if len(modelsList) != 0 {
		t.Fatalf("expected empty models array, got %d items", len(modelsList))
	}
}

func TestModelsList_WithBuilder_ReturnsError(t *testing.T) {
	// When the builder returns an error, ModelsList should respond with 500.
	src := &stubSource{err: context.DeadlineExceeded}
	builder := models.NewBuilder(nil, src)

	h := NewStubsHandlers(builder, nil)
	req := httptest.NewRequest("GET", "/api/models", nil)
	rec := httptest.NewRecorder()
	h.ModelsList(rec, req)

	if rec.Code != 500 {
		t.Fatalf("expected 500 on builder error, got %d", rec.Code)
	}
}
