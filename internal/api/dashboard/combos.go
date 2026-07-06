package dashboard

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"github.com/9router/9router/internal/db/repos"
	"github.com/google/uuid"
)

var comboNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_.\-]+$`)

// CombosHandlers holds combo dependencies.
type CombosHandlers struct {
	Repos *repos.Repos
}

// NewCombosHandlers creates combo handlers.
func NewCombosHandlers(repos *repos.Repos) *CombosHandlers {
	return &CombosHandlers{Repos: repos}
}

// ListCombos handles GET /api/combos.
func (h *CombosHandlers) ListCombos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
		return
	}
	combos, err := listCombos(h.Repos.DB)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"combos": combos})
}

// CreateCombo handles POST /api/combos.
func (h *CombosHandlers) CreateCombo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	var body struct {
		Name   string   `json:"name"`
		Models []string `json:"models"`
		Kind   string   `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "Name is required")
		return
	}
	if !comboNameRegex.MatchString(body.Name) {
		writeError(w, http.StatusBadRequest, "invalid_request", "Name can only contain letters, numbers, -, _ and .")
		return
	}
	existing, err := getComboByName(h.Repos.DB, body.Name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if existing != nil {
		writeError(w, http.StatusBadRequest, "already_exists", "Combo name already exists")
		return
	}
	combo, err := createCombo(h.Repos.DB, body.Name, body.Kind, body.Models)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, combo)
}

// GetCombo handles GET /api/combos/{id}.
func (h *CombosHandlers) GetCombo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "GET required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	combo, err := getComboByID(h.Repos.DB, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if combo == nil {
		writeError(w, http.StatusNotFound, "not_found", "Combo not found")
		return
	}
	writeJSON(w, http.StatusOK, combo)
}

// UpdateCombo handles PATCH /api/combos/{id}.
func (h *CombosHandlers) UpdateCombo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "PATCH or PUT required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return
	}
	if name, ok := body["name"].(string); ok && name != "" {
		if !comboNameRegex.MatchString(name) {
			writeError(w, http.StatusBadRequest, "invalid_request", "Name can only contain letters, numbers, -, _ and .")
			return
		}
		existing, err := getComboByName(h.Repos.DB, name)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
			return
		}
		if existing != nil && existing.ID != id {
			writeError(w, http.StatusBadRequest, "already_exists", "Combo name already exists")
			return
		}
	}
	combo, err := updateCombo(h.Repos.DB, id, body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if combo == nil {
		writeError(w, http.StatusNotFound, "not_found", "Combo not found")
		return
	}
	// ponytail: combo rotation reset is deferred; it requires the runtime combo
	// service to be wired into the Go backend.
	writeJSON(w, http.StatusOK, combo)
}

// DeleteCombo handles DELETE /api/combos/{id}.
func (h *CombosHandlers) DeleteCombo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "DELETE required")
		return
	}
	id := idFromPath(r)
	if id == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "ID required")
		return
	}
	prev, err := getComboByID(h.Repos.DB, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	if prev == nil {
		writeError(w, http.StatusNotFound, "not_found", "Combo not found")
		return
	}
	if err := deleteCombo(h.Repos.DB, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	// ponytail: combo rotation reset is deferred.
	_ = prev
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// combo mirrors the JS combo table shape.
type combo struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Models    []string `json:"models"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

func listCombos(db *sql.DB) ([]combo, error) {
	rows, err := db.Query(`SELECT id, name, COALESCE(kind, '') AS kind, models, createdAt, updatedAt FROM combos ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []combo{}
	for rows.Next() {
		var c combo
		var modelsJSON string
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &modelsJSON, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(modelsJSON), &c.Models)
		out = append(out, c)
	}
	return out, rows.Err()
}

func getComboByID(db *sql.DB, id string) (*combo, error) {
	row := db.QueryRow(`SELECT id, name, COALESCE(kind, '') AS kind, models, createdAt, updatedAt FROM combos WHERE id = ?`, id)
	var c combo
	var modelsJSON string
	err := row.Scan(&c.ID, &c.Name, &c.Kind, &modelsJSON, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(modelsJSON), &c.Models)
	return &c, nil
}

func getComboByName(db *sql.DB, name string) (*combo, error) {
	row := db.QueryRow(`SELECT id, name, COALESCE(kind, '') AS kind, models, createdAt, updatedAt FROM combos WHERE name = ?`, name)
	var c combo
	var modelsJSON string
	err := row.Scan(&c.ID, &c.Name, &c.Kind, &modelsJSON, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(modelsJSON), &c.Models)
	return &c, nil
}

func createCombo(db *sql.DB, name, kind string, models []string) (*combo, error) {
	now := nowRFC3339()
	if models == nil {
		models = []string{}
	}
	modelsJSON, _ := json.Marshal(models)
	c := &combo{
		ID:        uuid.New().String(),
		Name:      name,
		Kind:      kind,
		Models:    models,
		CreatedAt: now,
		UpdatedAt: now,
	}
	_, err := db.Exec(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
		c.ID, c.Name, c.Kind, string(modelsJSON), c.CreatedAt, c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func updateCombo(db *sql.DB, id string, updates map[string]any) (*combo, error) {
	c, err := getComboByID(db, id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	if name, ok := updates["name"].(string); ok {
		c.Name = name
	}
	if kind, ok := updates["kind"].(string); ok {
		c.Kind = kind
	}
	if models, ok := updates["models"].([]any); ok {
		c.Models = make([]string, 0, len(models))
		for _, v := range models {
			if s, ok := v.(string); ok {
				c.Models = append(c.Models, s)
			}
		}
	}
	c.UpdatedAt = nowRFC3339()
	modelsJSON, _ := json.Marshal(c.Models)
	_, err = db.Exec(`UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
		c.Name, c.Kind, string(modelsJSON), c.UpdatedAt, id)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func deleteCombo(db *sql.DB, id string) error {
	_, err := db.Exec(`DELETE FROM combos WHERE id = ?`, id)
	return err
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
