package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/9router/9router/backend/internal/api/middleware"
	"github.com/9router/9router/backend/internal/api/v1"
	"github.com/9router/9router/backend/internal/auth"
	"github.com/9router/9router/backend/internal/db/repos"
	"github.com/9router/9router/backend/internal/models"
	"github.com/9router/9router/backend/internal/providers"
	"github.com/go-chi/chi/v5"
)

// Routes builds the chi router with logging, recovery, CORS, real-IP,
// auth, and v1 handlers.
func Routes(logger *slog.Logger, r *repos.Repos, registry *providers.Registry) http.Handler {
	builder := models.NewBuilder(registry, models.NewSQLSource(r.DB))

	router := chi.NewRouter()

	router.Use(middleware.RealIP)
	router.Use(middleware.Recovery(logger))
	router.Use(middleware.RequestLogger(logger))
	router.Use(middleware.NewCORS("").Wrap)

	router.Get("/health", healthHandler)
	router.Get("/shutdown", shutdownHandler)
	router.Get("/version", versionHandler)

	// Public OpenAI-compatible surface.
	router.Mount("/v1", v1Router(r, builder))

	// Legacy dashboard path kept for compatibility during the port.
	router.With(auth.APIKeyMiddleware(r.Keys)).Get("/api/v1/models", v1.ModelsHandler(builder))

	return router
}

func v1Router(r *repos.Repos, builder *models.Builder) http.Handler {
	router := chi.NewRouter()
	router.Use(auth.APIKeyMiddleware(r.Keys))
	router.Get("/models", v1.ModelsHandler(builder))
	return router
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func shutdownHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Shutting down...",
	})
}

func versionHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"currentVersion": "0.0.0-go",
		"latestVersion":  nil,
		"githubVersion":  nil,
		"hasUpdate":      false,
		"githubStatus":   "current",
		"runtime":        "go",
		"canAutoRestart": false,
		"installCommand": nil,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
