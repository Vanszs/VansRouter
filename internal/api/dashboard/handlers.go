package dashboard

import (
	"encoding/json"
	"net/http"

	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/network"
	"github.com/9router/9router/internal/providers"
	"github.com/9router/9router/internal/providers/executors"
	"github.com/google/uuid"
	"github.com/go-chi/chi/v5"
)

// ProxyPoolHandlers handles proxy pool management
type ProxyPoolHandlers struct {
	repo *repos.ProxyPoolRepo
}

// NewProxyPoolHandlers creates proxy pool handlers
func NewProxyPoolHandlers(repo *repos.ProxyPoolRepo) *ProxyPoolHandlers {
	return &ProxyPoolHandlers{repo: repo}
}

// List returns all proxy pools
func (h *ProxyPoolHandlers) List(w http.ResponseWriter, r *http.Request) {
	pools, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"proxyPools": pools})
}

// Get returns a proxy pool by ID
func (h *ProxyPoolHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	pool, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}
	if pool == nil {
		writeError(w, http.StatusNotFound, "not_found", "Proxy pool not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"proxyPool": pool})
}

// Create creates a new proxy pool
func (h *ProxyPoolHandlers) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProxyURL    string `json:"proxyUrl"`
		NoProxy     string `json:"noProxy"`
		Type        string `json:"type"`
		StrictProxy bool   `json:"strictProxy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	pool := &repos.ProxyPool{
		ID:        uuid.New().String(),
		IsActive:  true,
		Data:      mustMarshalJSON(map[string]any{"proxyUrl": body.ProxyURL, "noProxy": body.NoProxy, "type": body.Type, "strictProxy": body.StrictProxy}),
	}

	if err := h.repo.Create(r.Context(), pool); err != nil {
		writeError(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"proxyPool": pool})
}

// Update updates a proxy pool
func (h *ProxyPoolHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	pool, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}
	if pool == nil {
		writeError(w, http.StatusNotFound, "not_found", "Proxy pool not found")
		return
	}

	var body struct {
		ProxyURL    string `json:"proxyUrl"`
		NoProxy     string `json:"noProxy"`
		Type        string `json:"type"`
		StrictProxy bool   `json:"strictProxy"`
		IsActive    *bool  `json:"isActive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	pool.Data = mustMarshalJSON(map[string]any{"proxyUrl": body.ProxyURL, "noProxy": body.NoProxy, "type": body.Type, "strictProxy": body.StrictProxy})
	if body.IsActive != nil {
		pool.IsActive = *body.IsActive
	}

	if err := h.repo.Update(r.Context(), pool); err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"proxyPool": pool})
}

// Delete removes a proxy pool
func (h *ProxyPoolHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Test tests a proxy pool connection
func (h *ProxyPoolHandlers) Test(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	pool, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}
	if pool == nil {
		writeError(w, http.StatusNotFound, "not_found", "Proxy pool not found")
		return
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(pool.Data), &data); err != nil {
		writeError(w, http.StatusInternalServerError, "parse_failed", err.Error())
		return
	}

	proxyURL, _ := data["proxyUrl"].(string)
	result := network.TestProxyURL(r.Context(), proxyURL, "", 0)
	
	status := "failed"
	if result.OK {
		status = "ok"
	}
	if err := h.repo.UpdateTestStatus(r.Context(), id, status); err != nil {
		writeError(w, http.StatusInternalServerError, "update_status_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

// VercelDeploy handles Vercel proxy deployment
func (h *ProxyPoolHandlers) VercelDeploy(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Vercel deploy not yet implemented")
}

// CloudflareDeploy handles Cloudflare proxy deployment
func (h *ProxyPoolHandlers) CloudflareDeploy(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Cloudflare deploy not yet implemented")
}

// DenoDeploy handles Deno proxy deployment
func (h *ProxyPoolHandlers) DenoDeploy(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Deno deploy not yet implemented")
}

// ProviderNodeHandlers handles provider node management
type ProviderNodeHandlers struct {
	repo *repos.ProviderNodeRepo
}

// NewProviderNodeHandlers creates provider node handlers
func NewProviderNodeHandlers(repo *repos.ProviderNodeRepo) *ProviderNodeHandlers {
	return &ProviderNodeHandlers{repo: repo}
}

// List returns all provider nodes
func (h *ProviderNodeHandlers) List(w http.ResponseWriter, r *http.Request) {
	nodes, err := h.repo.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providerNodes": nodes})
}

// Get returns a provider node by ID
func (h *ProviderNodeHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	node, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}
	if node == nil {
		writeError(w, http.StatusNotFound, "not_found", "Provider node not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providerNode": node})
}

// Create creates a new provider node
func (h *ProviderNodeHandlers) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type string `json:"type"`
		Name string `json:"name"`
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	node := &repos.ProviderNode{
		ID:   uuid.New().String(),
		Type: body.Type,
		Name: body.Name,
		Data: body.Data,
	}

	if err := h.repo.Create(r.Context(), node); err != nil {
		writeError(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"providerNode": node})
}

// Update updates a provider node
func (h *ProviderNodeHandlers) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	node, err := h.repo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}
	if node == nil {
		writeError(w, http.StatusNotFound, "not_found", "Provider node not found")
		return
	}

	var body struct {
		Type string `json:"type"`
		Name string `json:"name"`
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	node.Type = body.Type
	node.Name = body.Name
	node.Data = body.Data

	if err := h.repo.Update(r.Context(), node); err != nil {
		writeError(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"providerNode": node})
}

// Delete removes a provider node
func (h *ProviderNodeHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.repo.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// Validate validates a provider node configuration
func (h *ProviderNodeHandlers) Validate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Type string `json:"type"`
		Name string `json:"name"`
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	// Parse provider data
	var providerData map[string]any
	if err := json.Unmarshal([]byte(body.Data), &providerData); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_data", err.Error())
		return
	}

	// Get executor for this provider type
	cfg := &executors.ProviderConfig{}
	exec := executors.Get(body.Type, cfg)
	if exec == nil {
		writeError(w, http.StatusBadRequest, "unknown_type", "Unknown provider type")
		return
	}

	// Try to build URL and headers
	creds := executors.Credentials{
		APIKey:               "test-key",
		ProviderSpecificData: providerData,
	}

	// Type assert to access BuildURL/BuildHeaders methods
	if baseExec, ok := exec.(*executors.BaseExecutor); ok {
		url := baseExec.BuildURL("test-model", false, 0, creds)
		headers := baseExec.BuildHeaders(creds, false)
		writeJSON(w, http.StatusOK, map[string]any{
			"valid":   true,
			"url":     url,
			"headers": headers,
		})
		return
	}

	// Fallback for non-BaseExecutor types
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":   true,
		"message": "executor created but detailed validation not available",
	})
}

// ProviderHandlers handles provider management
type ProviderHandlers struct {
	registry *providers.Registry
}

// NewProviderHandlers creates provider handlers
func NewProviderHandlers(registry *providers.Registry) *ProviderHandlers {
	return &ProviderHandlers{registry: registry}
}

// Get returns a provider by ID
func (h *ProviderHandlers) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	provider, ok := h.registry.Providers[id]
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Provider not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider": provider})
}

// Update updates a provider
func (h *ProviderHandlers) Update(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Provider update not yet implemented")
}

// Delete removes a provider
func (h *ProviderHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Provider delete not yet implemented")
}

// GetModels returns models for a provider
func (h *ProviderHandlers) GetModels(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	provider, ok := h.registry.Providers[id]
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Provider not found")
		return
	}

	var models []map[string]any
	if err := json.Unmarshal(provider.Models, &models); err != nil {
		writeError(w, http.StatusInternalServerError, "parse_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"models": models})
}

// Test tests a provider connection
func (h *ProviderHandlers) Test(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	provider, ok := h.registry.Providers[id]
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Provider not found")
		return
	}

	var body struct {
		APIKey string `json:"apiKey"`
		Model  string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	// Get executor
	cfg := &executors.ProviderConfig{}
	exec := executors.Get(id, cfg)
	if exec == nil {
		writeError(w, http.StatusBadRequest, "unknown_provider", "Unknown provider")
		return
	}

	// Build test request
	creds := executors.Credentials{
		APIKey: body.APIKey,
	}

	// Type assert to access BuildURL/BuildHeaders methods
	if baseExec, ok := exec.(*executors.BaseExecutor); ok {
		url := baseExec.BuildURL(body.Model, false, 0, creds)
		headers := baseExec.BuildHeaders(creds, false)
		writeJSON(w, http.StatusOK, map[string]any{
			"valid":   true,
			"url":     url,
			"headers": headers,
			"provider": provider,
		})
		return
	}

	// Fallback for non-BaseExecutor types
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":   true,
		"message": "executor created but detailed validation not available",
		"provider": provider,
	})
}

// TestModels tests multiple models for a provider
func (h *ProviderHandlers) TestModels(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Test models not yet implemented")
}

// ModelHandlers handles model management
type ModelHandlers struct {
	registry *providers.Registry
}

// NewModelHandlers creates model handlers
func NewModelHandlers(registry *providers.Registry) *ModelHandlers {
	return &ModelHandlers{registry: registry}
}

// AliasList returns model aliases
func (h *ModelHandlers) AliasList(w http.ResponseWriter, r *http.Request) {
	aliases := make(map[string]string)
	for _, p := range h.registry.Providers {
		if p.Alias != "" {
			aliases[p.Alias] = p.ID
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"aliases": aliases})
}

// AliasUpdate updates a model alias
func (h *ModelHandlers) AliasUpdate(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Alias update not yet implemented")
}

// AliasDelete removes a model alias
func (h *ModelHandlers) AliasDelete(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "not_implemented", "Alias delete not yet implemented")
}

// Availability returns model availability
func (h *ModelHandlers) Availability(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"models":           []any{},
		"unavailableCount": 0,
	})
}

// Custom returns custom models
func (h *ModelHandlers) Custom(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": []any{}})
}

// Disabled returns disabled models
func (h *ModelHandlers) Disabled(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"disabled": map[string]any{}})
}

// Test handles model test
func (h *ModelHandlers) Test(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      false,
		"error":   "model ping is not implemented in the go port yet",
		"latency": 0,
		"model":   "",
	})
}

func mustMarshalJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
