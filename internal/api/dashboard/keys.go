package dashboard

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/9router/9router/internal/db/repos"
)

// KeysHandlers holds API-key dependencies.
type KeysHandlers struct {
	Repos *repos.Repos
}

// NewKeysHandlers creates API-key handlers.
func NewKeysHandlers(repos *repos.Repos) *KeysHandlers {
	return &KeysHandlers{Repos: repos}
}

// ListKeys handles GET /api/keys.
func (h *KeysHandlers) ListKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
		return
	}
	keys, err := h.Repos.Keys.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if keys == nil {
		keys = []*repos.APIKey{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

// CreateKey handles POST /api/keys.
func (h *KeysHandlers) CreateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Name is required")
		return
	}
	machineID, err := machineID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	key := generateAPIKey()
	created, err := h.Repos.Keys.Create(body.Name, machineID, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"key":       created.Key,
		"name":      created.Name,
		"id":        created.ID,
		"machineId": created.MachineID,
	})
}

// GetKey handles GET /api/keys/{id}.
func (h *KeysHandlers) GetKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	key, err := h.Repos.Keys.GetByID(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if key == nil {
		writeError(w, http.StatusNotFound, "not_found", "Key not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": key})
}

// UpdateKey handles PATCH /api/keys/{id}.
func (h *KeysHandlers) UpdateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "PATCH or PUT required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	body, bytes, err := readJSONBody(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	var typed struct {
		IsActive *bool `json:"isActive"`
	}
	_ = json.Unmarshal(bytes, &typed)

	updated, err := h.Repos.Keys.Update(id, func(k *repos.APIKey) {
		if typed.IsActive != nil {
			k.IsActive = *typed.IsActive
		}
		if _, ok := body["allowedProviders"]; ok {
			k.AllowedProviders = normalizeACL(body["allowedProviders"])
		}
		if _, ok := body["allowedCombos"]; ok {
			k.AllowedCombos = normalizeACL(body["allowedCombos"])
		}
		if _, ok := body["allowedKinds"]; ok {
			k.AllowedKinds = normalizeACL(body["allowedKinds"])
		}
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "not_found", "Key not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": updated})
}

func normalizeACL(v any) []string {
	if v == nil {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// DeleteKey handles DELETE /api/keys/{id}.
func (h *KeysHandlers) DeleteKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "DELETE required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	ok, err := h.Repos.Keys.Delete(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Key not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Key deleted successfully"})
}

func generateAPIKey() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "vr-" + hex.EncodeToString(b)
}

func machineID() (string, error) {
	for _, p := range []string{"/var/lib/dbus/machine-id", "/etc/machine-id"} {
		if b, err := os.ReadFile(p); err == nil && len(b) > 0 {
			return strings.TrimSpace(string(b)), nil
		}
	}
	if h, err := os.Hostname(); err == nil && h != "" {
		return h, nil
	}
	return generateAPIKey(), nil
}
