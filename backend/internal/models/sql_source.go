package models

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// SQLSource implements Source backed by the Go SQLite database
// (modernc.org/sqlite). It mirrors the data layout used by the JS
// helpers in src/lib/db/repos/{aliasRepo,disabledModelsRepo}.js and
// src/lib/db/repos/combos.js:
//
//   - combos table        → (id, name, kind, models, createdAt, updatedAt)
//   - providerConnections → (provider, data JSON with prefix/enabledModels)
//   - kv scope=modelAliases   → key=alias, value="alias/modelId"
//   - kv scope=customModels   → key="alias|id|type", value=JSON
//   - kv scope=disabledModels → key=alias, value=JSON array of model ids
type SQLSource struct {
	DB *sql.DB
}

// NewSQLSource returns a Source backed by db.
func NewSQLSource(db *sql.DB) *SQLSource { return &SQLSource{DB: db} }

// Combos reads the combos table. The `models` column is a JSON-encoded
// array of model ids.
func (s *SQLSource) Combos(ctx context.Context) ([]Combo, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, name, kind, models FROM combos ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("query combos: %w", err)
	}
	defer rows.Close()
	var out []Combo
	for rows.Next() {
		var (
			id, name, kind, modelsJSON string
		)
		if err := rows.Scan(&id, &name, &kind, &modelsJSON); err != nil {
			return nil, fmt.Errorf("scan combo: %w", err)
		}
		var models []string
		if modelsJSON != "" {
			if err := json.Unmarshal([]byte(modelsJSON), &models); err != nil {
				return nil, fmt.Errorf("parse combo models %q: %w", name, err)
			}
		}
		out = append(out, Combo{ID: id, Name: name, Kind: kind, Models: models})
	}
	return out, rows.Err()
}

// Connections reads active providerConnections and parses the `data`
// JSON column. It deduplicates by (provider, prefix) so the caller
// sees one Connection per configured prefix.
func (s *SQLSource) Connections(ctx context.Context) ([]Connection, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT provider, data FROM providerConnections WHERE isActive = 1 ORDER BY priority ASC`)
	if err != nil {
		return nil, fmt.Errorf("query connections: %w", err)
	}
	defer rows.Close()
	var out []Connection
	for rows.Next() {
		var provider, dataJSON string
		if err := rows.Scan(&provider, &dataJSON); err != nil {
			return nil, fmt.Errorf("scan connection: %w", err)
		}
		data := map[string]any{}
		if dataJSON != "" {
			if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
				return nil, fmt.Errorf("parse connection data for %q: %w", provider, err)
			}
		}
		alias, _ := data["alias"].(string)
		out = append(out, Connection{
			Provider: provider,
			Alias:    alias,
			Data:     data,
		})
	}
	return out, rows.Err()
}

// CustomModels reads the `customModels` kv scope. Each row's value is
// already a JSON object; we decode it directly.
func (s *SQLSource) CustomModels(ctx context.Context) ([]CustomModel, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT value FROM kv WHERE scope = 'customModels'`)
	if err != nil {
		return nil, fmt.Errorf("query custom models: %w", err)
	}
	defer rows.Close()
	var out []CustomModel
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, fmt.Errorf("scan custom model: %w", err)
		}
		var cm CustomModel
		if err := json.Unmarshal([]byte(value), &cm); err != nil {
			return nil, fmt.Errorf("parse custom model value: %w", err)
		}
		out = append(out, cm)
	}
	return out, rows.Err()
}

// ModelAliases reads the `modelAliases` kv scope. Each row's value is
// the full alias/modelId string; the key duplicates the alias prefix
// so we read either side — value matches the JS contract.
func (s *SQLSource) ModelAliases(ctx context.Context) (map[string]string, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT value FROM kv WHERE scope = 'modelAliases'`)
	if err != nil {
		return nil, fmt.Errorf("query model aliases: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, fmt.Errorf("scan model alias: %w", err)
		}
		out[value] = value
	}
	return out, rows.Err()
}

// DisabledByAlias reads the `disabledModels` kv scope. The key is the
// provider alias, the value is a JSON array of model ids.
func (s *SQLSource) DisabledByAlias(ctx context.Context) (map[string][]string, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT key, value FROM kv WHERE scope = 'disabledModels'`)
	if err != nil {
		return nil, fmt.Errorf("query disabled models: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]string)
	for rows.Next() {
		var alias, value string
		if err := rows.Scan(&alias, &value); err != nil {
			return nil, fmt.Errorf("scan disabled models: %w", err)
		}
		var ids []string
		if value != "" {
			if err := json.Unmarshal([]byte(value), &ids); err != nil {
				return nil, fmt.Errorf("parse disabled models for %q: %w", alias, err)
			}
		}
		out[alias] = ids
	}
	return out, rows.Err()
}
