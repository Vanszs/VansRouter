package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// KVRepo provides generic key-value access backed by the `kv` table.
// Each entry is scoped (e.g. "modelAliases", "customModels", "disabledModels").
//
// CREATE TABLE kv (scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope, key));
type KVRepo struct {
	db *sql.DB
}

// NewKVRepo creates a KVRepo backed by db.
func NewKVRepo(db *sql.DB) *KVRepo {
	return &KVRepo{db: db}
}

// GetAll returns all key-value pairs for a scope as a map[string]string.
func (r *KVRepo) GetAll(scope string) (map[string]string, error) {
	rows, err := r.db.Query(`SELECT key, value FROM kv WHERE scope = ?`, scope)
	if err != nil {
		return nil, fmt.Errorf("kv get all %q: %w", scope, err)
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, fmt.Errorf("kv scan: %w", err)
		}
		result[k] = v
	}
	return result, rows.Err()
}

// Get returns the value for a scope+key pair, or "" if not found.
func (r *KVRepo) Get(scope, key string) (string, bool, error) {
	var value string
	err := r.db.QueryRow(`SELECT value FROM kv WHERE scope = ? AND key = ?`, scope, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("kv get %q/%q: %w", scope, key, err)
	}
	return value, true, nil
}

// GetJSON returns the value for a scope+key parsed as JSON into target.
// Returns false if the key doesn't exist.
func (r *KVRepo) GetJSON(scope, key string, target any) (bool, error) {
	value, found, err := r.Get(scope, key)
	if err != nil || !found {
		return found, err
	}
	if err := json.Unmarshal([]byte(value), target); err != nil {
		return false, fmt.Errorf("kv getJSON %q/%q: %w", scope, key, err)
	}
	return true, nil
}

// Set stores a key-value pair (upsert).
func (r *KVRepo) Set(scope, key, value string) error {
	_, err := r.db.Exec(
		`INSERT INTO kv (scope, key, value) VALUES (?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
		scope, key, value,
	)
	if err != nil {
		return fmt.Errorf("kv set %q/%q: %w", scope, key, err)
	}
	return nil
}

// SetJSON stores a key with a JSON-serialized value.
func (r *KVRepo) SetJSON(scope, key string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("kv setJSON marshal %q/%q: %w", scope, key, err)
	}
	return r.Set(scope, key, string(data))
}

// Delete removes a key from a scope.
func (r *KVRepo) Delete(scope, key string) error {
	_, err := r.db.Exec(`DELETE FROM kv WHERE scope = ? AND key = ?`, scope, key)
	if err != nil {
		return fmt.Errorf("kv delete %q/%q: %w", scope, key, err)
	}
	return nil
}

// DeleteScope removes all keys in a scope.
func (r *KVRepo) DeleteScope(scope string) error {
	_, err := r.db.Exec(`DELETE FROM kv WHERE scope = ?`, scope)
	if err != nil {
		return fmt.Errorf("kv delete scope %q: %w", scope, err)
	}
	return nil
}
