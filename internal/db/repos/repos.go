package repos

import "database/sql"

// Repos holds all data-access repositories in one place so services can
// receive a single dependency.
type Repos struct {
	DB            *sql.DB
	Keys          *KeysRepo
	Accounts      *AccountsRepo
	Usage         *UsageRepo
	Settings      *SettingsRepo
	ProxyPools    *ProxyPoolRepo
	ProviderNodes *ProviderNodeRepo
}

// New creates a Repos instance backed by db.
func New(db *sql.DB) *Repos {
	return &Repos{
		DB:            db,
		Keys:          NewKeysRepo(db),
		Accounts:      NewAccountsRepo(db),
		Usage:         NewUsageRepo(db),
		Settings:      NewSettingsRepo(db),
		ProxyPools:    NewProxyPoolRepo(db),
		ProviderNodes: NewProviderNodeRepo(db),
	}
}
