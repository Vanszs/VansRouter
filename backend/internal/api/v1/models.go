// Package v1 holds the OpenAI-compatible HTTP handlers. Each handler
// is constructed with the dependencies it needs (builder, logger) so
// the parent router can mount it without touching globals.
package v1

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/9router/9router/backend/internal/models"
)

// ModelsHandler returns a handler for GET /v1/models that produces the
// OpenAI-compatible list response: {"object":"list","data":[...]}.
func ModelsHandler(builder *models.Builder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kindFilter := parseKindFilter(r.URL.Query().Get("kind"))

		list, err := builder.BuildModelsList(r.Context(), kindFilter)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   list,
		})
	}
}

// parseKindFilter maps a comma-separated ?kind= query to a Kind slice.
// Empty input returns nil → builder defaults to all kinds.
func parseKindFilter(raw string) []models.Kind {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]models.Kind, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, models.Kind(p))
	}
	return out
}

func writeError(w http.ResponseWriter, status int, errType, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": msg,
			"type":    errType,
		},
	})
}
