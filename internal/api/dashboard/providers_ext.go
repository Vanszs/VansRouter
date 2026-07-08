package dashboard

import (
	"encoding/json"
	"net/http"

	"github.com/9router/9router/internal/db/repos"
	"github.com/go-chi/chi/v5"
)

// ProvidersExtHandlers provides additional provider connection endpoints
// beyond the base CRUD operations in providers.go
type ProvidersExtHandlers struct {
	accounts *repos.AccountsRepo
}

// NewProvidersExtHandlers creates handlers for extended provider operations
func NewProvidersExtHandlers(accounts *repos.AccountsRepo) *ProvidersExtHandlers {
	return &ProvidersExtHandlers{accounts: accounts}
}

// GetConnection handles GET /api/providers/{id}
func (h *ProvidersExtHandlers) GetConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Connection ID required")
		return
	}

	conn, err := h.accounts.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to fetch connection")
		return
	}
	if conn == nil {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	// Return connection in the same shape as the list endpoint
	response := map[string]any{
		"id":           conn.ID,
		"provider":     conn.Provider,
		"authType":     conn.AuthType,
		"name":         conn.Name,
		"email":        conn.Email,
		"priority":     conn.Priority,
		"isActive":     conn.IsActive,
		"createdAt":    conn.CreatedAt,
		"updatedAt":    conn.UpdatedAt,
		"displayName":  conn.DisplayName,
		"globalPriority": conn.GlobalPriority,
		"defaultModel": conn.DefaultModel,
		"testStatus":   conn.TestStatus,
		"lastTested":   conn.LastTested,
		"lastError":    conn.LastError,
		"lastErrorAt":  conn.LastErrorAt,
	}

	writeJSON(w, http.StatusOK, response)
}

// UpdateConnection handles PUT /api/providers/{id}
func (h *ProvidersExtHandlers) UpdateConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Connection ID required")
		return
	}

	var body struct {
		Provider       *string `json:"provider"`
		Name           *string `json:"name"`
		Email          *string `json:"email"`
		Priority       *int    `json:"priority"`
		IsActive       *bool   `json:"isActive"`
		DisplayName    *string `json:"displayName"`
		GlobalPriority *int    `json:"globalPriority"`
		DefaultModel   *string `json:"defaultModel"`
		TestStatus     *string `json:"testStatus"`
		LastTested     *string `json:"lastTested"`
		LastError      *string `json:"lastError"`
		LastErrorAt    *string `json:"lastErrorAt"`
		APIKey         *string `json:"apiKey"`
		AccessToken    *string `json:"accessToken"`
		RefreshToken   *string `json:"refreshToken"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "Invalid JSON body")
		return
	}

	updated, err := h.accounts.Update(id, func(acc *repos.Account) {
		if body.Provider != nil {
			acc.Provider = *body.Provider
		}
		if body.Name != nil {
			acc.Name = *body.Name
		}
		if body.Email != nil {
			acc.Email = *body.Email
		}
		if body.Priority != nil {
			acc.Priority = *body.Priority
		}
		if body.IsActive != nil {
			acc.IsActive = *body.IsActive
		}
		if body.DisplayName != nil {
			acc.DisplayName = *body.DisplayName
		}
		if body.GlobalPriority != nil {
			acc.GlobalPriority = *body.GlobalPriority
		}
		if body.DefaultModel != nil {
			acc.DefaultModel = *body.DefaultModel
		}
		if body.TestStatus != nil {
			acc.TestStatus = *body.TestStatus
		}
		if body.LastTested != nil {
			acc.LastTested = *body.LastTested
		}
		if body.LastError != nil {
			acc.LastError = *body.LastError
		}
		if body.LastErrorAt != nil {
			acc.LastErrorAt = *body.LastErrorAt
		}
		if body.APIKey != nil {
			acc.APIKey = *body.APIKey
		}
		if body.AccessToken != nil {
			acc.AccessToken = *body.AccessToken
		}
		if body.RefreshToken != nil {
			acc.RefreshToken = *body.RefreshToken
		}
	})

	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to update connection")
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	response := map[string]any{
		"connection": map[string]any{
			"id":           updated.ID,
			"provider":     updated.Provider,
			"authType":     updated.AuthType,
			"name":         updated.Name,
			"email":        updated.Email,
			"priority":     updated.Priority,
			"isActive":     updated.IsActive,
			"createdAt":    updated.CreatedAt,
			"updatedAt":    updated.UpdatedAt,
			"displayName":  updated.DisplayName,
			"globalPriority": updated.GlobalPriority,
			"defaultModel": updated.DefaultModel,
		},
	}

	writeJSON(w, http.StatusOK, response)
}

// DeleteConnection handles DELETE /api/providers/{id}
func (h *ProvidersExtHandlers) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Connection ID required")
		return
	}

	deleted, err := h.accounts.Delete(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Failed to delete connection")
		return
	}
	if !deleted {
		writeError(w, http.StatusNotFound, "not_found", "Connection not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message": "Connection deleted successfully",
	})
}
