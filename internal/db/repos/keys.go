package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// APIKey mirrors the apiKeys table row and uses JSON text columns for ACL lists.
// DB NULL means "all allowed"; "[]" means "none allowed".
// ponytail: JSON-encoded allow-lists are simple, but the JS schema stores them as comma-joined strings; align storage format later.
type APIKey struct {
	ID               string   `json:"id"`
	Key              string   `json:"key"`
	Name             string   `json:"name"`
	MachineID        string   `json:"machineId"`
	IsActive         bool     `json:"isActive"`
	CreatedAt        string   `json:"createdAt"`
	AllowedProviders []string `json:"allowedProviders"`
	AllowedCombos    []string `json:"allowedCombos"`
	AllowedKinds     []string `json:"allowedKinds"`
}

// KeysRepo provides CRUD and validation for API keys with a short TTL cache.
type KeysRepo struct {
	db    *sql.DB
	cache *TTLCache[string, *APIKey]
}

// NewKeysRepo creates a new API-key repository with a 60-second lookup cache.
func NewKeysRepo(db *sql.DB) *KeysRepo {
	return &KeysRepo{
		db:    db,
		cache: NewTTLCache[string, *APIKey](60 * time.Second),
	}
}

func parsePermList(raw sql.NullString) []string {
	if !raw.Valid {
		return nil
	}
	var list []string
	if err := json.Unmarshal([]byte(raw.String), &list); err != nil {
		return nil
	}
	return list
}

func serializePermList(list []string) sql.NullString {
	if list == nil {
		return sql.NullString{Valid: false}
	}
	b, _ := json.Marshal(list)
	return sql.NullString{String: string(b), Valid: true}
}

func (r *KeysRepo) rowToKey(row *sql.Row) (*APIKey, error) {
	var k APIKey
	var providers, combos, kinds sql.NullString
	var isActive int
	err := row.Scan(
		&k.ID, &k.Key, &k.Name, &k.MachineID, &isActive, &k.CreatedAt,
		&providers, &combos, &kinds,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	k.IsActive = isActive == 1
	k.AllowedProviders = parsePermList(providers)
	k.AllowedCombos = parsePermList(combos)
	k.AllowedKinds = parsePermList(kinds)
	return &k, nil
}

func (r *KeysRepo) scanKey(rows *sql.Rows) (*APIKey, error) {
	var k APIKey
	var providers, combos, kinds sql.NullString
	var isActive int
	if err := rows.Scan(
		&k.ID, &k.Key, &k.Name, &k.MachineID, &isActive, &k.CreatedAt,
		&providers, &combos, &kinds,
	); err != nil {
		return nil, err
	}
	k.IsActive = isActive == 1
	k.AllowedProviders = parsePermList(providers)
	k.AllowedCombos = parsePermList(combos)
	k.AllowedKinds = parsePermList(kinds)
	return &k, nil
}

// List returns all API keys ordered by creation time.
func (r *KeysRepo) List() ([]*APIKey, error) {
	rows, err := r.db.Query(`SELECT id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds FROM apiKeys ORDER BY createdAt ASC`)
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}
	defer rows.Close()

	var keys []*APIKey
	for rows.Next() {
		k, err := r.scanKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// GetByID returns an API key by its UUID id.
func (r *KeysRepo) GetByID(id string) (*APIKey, error) {
	row := r.db.QueryRow(`SELECT id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds FROM apiKeys WHERE id = ?`, id)
	return r.rowToKey(row)
}

// GetByKey returns an active API key by its key string, using the TTL cache.
func (r *KeysRepo) GetByKey(key string) (*APIKey, error) {
	if cached, ok := r.cache.Get(key); ok {
		return cached, nil
	}
	row := r.db.QueryRow(`SELECT id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds FROM apiKeys WHERE key = ?`, key)
	k, err := r.rowToKey(row)
	if err != nil {
		return nil, fmt.Errorf("get api key: %w", err)
	}
	if k != nil {
		r.cache.Set(key, k)
	}
	return k, nil
}

// Create inserts a new API key. The key string is supplied by the caller (e.g. generated elsewhere).
func (r *KeysRepo) Create(name, machineID, key string) (*APIKey, error) {
	if machineID == "" {
		return nil, fmt.Errorf("machineId is required")
	}
	if key == "" {
		return nil, fmt.Errorf("key is required")
	}
	k := &APIKey{
		ID:        uuid.New().String(),
		Name:      name,
		Key:       key,
		MachineID: machineID,
		IsActive:  true,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_, err := r.db.Exec(
		`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedProviders, allowedCombos, allowedKinds) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		k.ID, k.Key, k.Name, k.MachineID, 1, k.CreatedAt, nil, nil, nil,
	)
	if err != nil {
		return nil, fmt.Errorf("create api key: %w", err)
	}
	r.cache.Invalidate(key)
	return k, nil
}

// Update merges the provided fields into the existing key and invalidates the cache.
func (r *KeysRepo) Update(id string, fn func(*APIKey)) (*APIKey, error) {
	existing, err := r.GetByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}
	fn(existing)
	_, err = r.db.Exec(
		`UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedProviders = ?, allowedCombos = ?, allowedKinds = ? WHERE id = ?`,
		existing.Key, existing.Name, existing.MachineID, boolToInt(existing.IsActive),
		serializePermList(existing.AllowedProviders),
		serializePermList(existing.AllowedCombos),
		serializePermList(existing.AllowedKinds),
		id,
	)
	if err != nil {
		return nil, fmt.Errorf("update api key: %w", err)
	}
	r.cache.Invalidate(existing.Key)
	return existing, nil
}

// Delete removes an API key by id and invalidates the cache.
func (r *KeysRepo) Delete(id string) (bool, error) {
	var key string
	if err := r.db.QueryRow(`SELECT key FROM apiKeys WHERE id = ?`, id).Scan(&key); err == sql.ErrNoRows {
		return false, nil
	} else if err != nil {
		return false, fmt.Errorf("delete api key lookup: %w", err)
	}
	res, err := r.db.Exec(`DELETE FROM apiKeys WHERE id = ?`, id)
	if err != nil {
		return false, fmt.Errorf("delete api key: %w", err)
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		r.cache.Invalidate(key)
	}
	return n > 0, nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
