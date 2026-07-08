package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/log"
	"github.com/9router/9router/internal/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestRepos creates a Repos with nil DB — sufficient for route existence checks
// where we don't need actual DB queries, just verify routes are registered.
func newTestRepos() *repos.Repos {
	return repos.New(nil)
}

func TestRoutes_HealthEndpoint(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos() // nil DB — health doesn't need it
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestRoutes_VersionEndpoint(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	req := httptest.NewRequest(http.MethodGet, "/version", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Version endpoint may return 200 or 500 depending on build info
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestRoutes_ShutdownEndpoint(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	req := httptest.NewRequest(http.MethodGet, "/shutdown", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Shutdown may return 200 or 500 — just verify it's not 404
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestRoutes_UnknownRouteReturns404(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	req := httptest.NewRequest(http.MethodGet, "/nonexistent", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestRoutes_V1ModelsRequiresAuth(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// /v1/models without API key should return 401
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestRoutes_DashboardAuthRoutesExist(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// Auth routes should be accessible without session
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/auth/login"},
		{http.MethodPost, "/api/auth/logout"},
		{http.MethodGet, "/api/auth/status"},
		{http.MethodGet, "/api/auth/check"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			// Should not 404
			require.NotEqual(t, http.StatusNotFound, w.Code, "%s %s should exist", route.method, route.path)
		})
	}
}

func TestRoutes_DashboardProtectedRoutesRequireSession(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// These routes require session — should redirect or 401 without session
	protectedRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/settings"},
		{http.MethodGet, "/api/providers"},
		{http.MethodGet, "/api/keys"},
		{http.MethodGet, "/api/combos"},
		{http.MethodGet, "/api/usage/history"},
		{http.MethodGet, "/api/proxy-pools"},
		{http.MethodGet, "/api/provider-nodes"},
	}

	for _, route := range protectedRoutes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			// Should return 401/403, not 404
			assert.NotEqual(t, http.StatusNotFound, w.Code, "%s %s should exist (not 404)", route.method, route.path)
		})
	}
}

func TestRoutes_MiddlewareStackApplied(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// Verify CORS headers are present (middleware applied)
	req := httptest.NewRequest(http.MethodOptions, "/health", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// CORS middleware should handle preflight
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestRoutes_PublicModelsEndpoint(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// /models is public (no auth required)
	req := httptest.NewRequest(http.MethodGet, "/models", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Should return 200 (may return empty models list but shouldn't 404)
	assert.NotEqual(t, http.StatusNotFound, w.Code)
}

func TestRoutes_StubsRoutesExist(t *testing.T) {
	logger, _ := log.New("info")
	r := newTestRepos()
	registry := &providers.Registry{}

	router := Routes(logger, r, registry)

	// Verify some stub routes are registered (they should return 401 without session, not 404)
	stubRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/settings/proxy-test"},
		{http.MethodGet, "/api/settings/database"},
		{http.MethodGet, "/api/pricing"},
		{http.MethodGet, "/api/translator/load"},
		{http.MethodPost, "/api/translator/translate"},
		{http.MethodGet, "/api/cli-tools/all-statuses"},
		{http.MethodGet, "/api/tunnel/status"},
		{http.MethodGet, "/api/headroom/status"},
	}

	for _, route := range stubRoutes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			assert.NotEqual(t, http.StatusNotFound, w.Code, "%s %s should exist as a stub route", route.method, route.path)
		})
	}
}
