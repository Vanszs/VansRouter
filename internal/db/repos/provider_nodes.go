package repos

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ProviderNode represents a provider node configuration
type ProviderNode struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	Name      string    `json:"name"`
	Data      string    `json:"data"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProviderNodeRepo handles provider node database operations
type ProviderNodeRepo struct {
	db *sql.DB
}

// NewProviderNodeRepo creates a new provider node repository
func NewProviderNodeRepo(db *sql.DB) *ProviderNodeRepo {
	return &ProviderNodeRepo{db: db}
}

// List returns all provider nodes
func (r *ProviderNodeRepo) List(ctx context.Context) ([]ProviderNode, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, type, name, data, createdAt, updatedAt
		FROM providerNodes
		ORDER BY createdAt DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query providerNodes: %w", err)
	}
	defer rows.Close()

	var nodes []ProviderNode
	for rows.Next() {
		var n ProviderNode
		err := rows.Scan(&n.ID, &n.Type, &n.Name, &n.Data, &n.CreatedAt, &n.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan providerNode: %w", err)
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

// ListByType returns provider nodes by type
func (r *ProviderNodeRepo) ListByType(ctx context.Context, nodeType string) ([]ProviderNode, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, type, name, data, createdAt, updatedAt
		FROM providerNodes
		WHERE type = ?
		ORDER BY createdAt DESC
	`, nodeType)
	if err != nil {
		return nil, fmt.Errorf("query providerNodes by type: %w", err)
	}
	defer rows.Close()

	var nodes []ProviderNode
	for rows.Next() {
		var n ProviderNode
		err := rows.Scan(&n.ID, &n.Type, &n.Name, &n.Data, &n.CreatedAt, &n.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan providerNode: %w", err)
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

// GetByID returns a provider node by ID
func (r *ProviderNodeRepo) GetByID(ctx context.Context, id string) (*ProviderNode, error) {
	var n ProviderNode
	err := r.db.QueryRowContext(ctx, `
		SELECT id, type, name, data, createdAt, updatedAt
		FROM providerNodes
		WHERE id = ?
	`, id).Scan(&n.ID, &n.Type, &n.Name, &n.Data, &n.CreatedAt, &n.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get providerNode: %w", err)
	}
	return &n, nil
}

// Create inserts a new provider node
func (r *ProviderNodeRepo) Create(ctx context.Context, n *ProviderNode) error {
	now := time.Now()
	n.CreatedAt = now
	n.UpdatedAt = now

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO providerNodes (id, type, name, data, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
	`, n.ID, n.Type, n.Name, n.Data, n.CreatedAt, n.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create providerNode: %w", err)
	}
	return nil
}

// Update updates a provider node
func (r *ProviderNodeRepo) Update(ctx context.Context, n *ProviderNode) error {
	n.UpdatedAt = time.Now()

	result, err := r.db.ExecContext(ctx, `
		UPDATE providerNodes
		SET type = ?, name = ?, data = ?, updatedAt = ?
		WHERE id = ?
	`, n.Type, n.Name, n.Data, n.UpdatedAt, n.ID)
	if err != nil {
		return fmt.Errorf("update providerNode: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("providerNode not found: %s", n.ID)
	}
	return nil
}

// Delete removes a provider node
func (r *ProviderNodeRepo) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM providerNodes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete providerNode: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("providerNode not found: %s", id)
	}
	return nil
}
