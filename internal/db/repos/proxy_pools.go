package repos

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ProxyPool represents a proxy pool configuration
type ProxyPool struct {
	ID           string    `json:"id"`
	IsActive     bool      `json:"isActive"`
	TestStatus   string    `json:"testStatus"`
	Data         string    `json:"data"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// ProxyPoolRepo handles proxy pool database operations
type ProxyPoolRepo struct {
	db *sql.DB
}

// NewProxyPoolRepo creates a new proxy pool repository
func NewProxyPoolRepo(db *sql.DB) *ProxyPoolRepo {
	return &ProxyPoolRepo{db: db}
}

// List returns all proxy pools
func (r *ProxyPoolRepo) List(ctx context.Context) ([]ProxyPool, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, isActive, testStatus, data, createdAt, updatedAt
		FROM proxyPools
		ORDER BY createdAt DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query proxyPools: %w", err)
	}
	defer rows.Close()

	var pools []ProxyPool
	for rows.Next() {
		var p ProxyPool
		var isActive int
		err := rows.Scan(&p.ID, &isActive, &p.TestStatus, &p.Data, &p.CreatedAt, &p.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scan proxyPool: %w", err)
		}
		p.IsActive = isActive == 1
		pools = append(pools, p)
	}
	return pools, rows.Err()
}

// GetByID returns a proxy pool by ID
func (r *ProxyPoolRepo) GetByID(ctx context.Context, id string) (*ProxyPool, error) {
	var p ProxyPool
	var isActive int
	err := r.db.QueryRowContext(ctx, `
		SELECT id, isActive, testStatus, data, createdAt, updatedAt
		FROM proxyPools
		WHERE id = ?
	`, id).Scan(&p.ID, &isActive, &p.TestStatus, &p.Data, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get proxyPool: %w", err)
	}
	p.IsActive = isActive == 1
	return &p, nil
}

// Create inserts a new proxy pool
func (r *ProxyPoolRepo) Create(ctx context.Context, p *ProxyPool) error {
	now := time.Now()
	p.CreatedAt = now
	p.UpdatedAt = now

	_, err := r.db.ExecContext(ctx, `
		INSERT INTO proxyPools (id, isActive, testStatus, data, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
	`, p.ID, boolToInt(p.IsActive), p.TestStatus, p.Data, p.CreatedAt, p.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create proxyPool: %w", err)
	}
	return nil
}

// Update updates a proxy pool
func (r *ProxyPoolRepo) Update(ctx context.Context, p *ProxyPool) error {
	p.UpdatedAt = time.Now()

	result, err := r.db.ExecContext(ctx, `
		UPDATE proxyPools
		SET isActive = ?, testStatus = ?, data = ?, updatedAt = ?
		WHERE id = ?
	`, boolToInt(p.IsActive), p.TestStatus, p.Data, p.UpdatedAt, p.ID)
	if err != nil {
		return fmt.Errorf("update proxyPool: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("proxyPool not found: %s", p.ID)
	}
	return nil
}

// Delete removes a proxy pool
func (r *ProxyPoolRepo) Delete(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM proxyPools WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete proxyPool: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("proxyPool not found: %s", id)
	}
	return nil
}

// UpdateTestStatus updates the test status of a proxy pool
func (r *ProxyPoolRepo) UpdateTestStatus(ctx context.Context, id, status string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE proxyPools
		SET testStatus = ?, updatedAt = ?
		WHERE id = ?
	`, status, time.Now(), id)
	if err != nil {
		return fmt.Errorf("update testStatus: %w", err)
	}
	return nil
}
