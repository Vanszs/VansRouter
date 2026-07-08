package services

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"runtime"
	"strings"
	"time"
)

// CursorService handles Cursor IDE token import (not full OAuth — token extracted
// from local SQLite db). Source: src/lib/oauth/services/cursor.js
type CursorService struct {
	ClientVersion string
	ClientType    string
}

// DefaultCursorConfig returns default Cursor config values.
func DefaultCursorConfig() CursorConfig {
	return CursorConfig{
		ClientVersion: "0.42.0",
		ClientType:    "vscode",
		TokenStoragePaths: CursorTokenPaths{
			Linux:   "~/.config/Cursor/User/globalStorage/state.vscdb",
			MacOS:   "/Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
			Windows: "%APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
		},
	}
}

// CursorConfig holds Cursor-specific configuration.
type CursorConfig struct {
	ClientVersion    string
	ClientType       string
	TokenStoragePaths CursorTokenPaths
}

// CursorTokenPaths holds platform-specific paths to Cursor's state.vscdb.
type CursorTokenPaths struct {
	Linux   string
	MacOS   string
	Windows string
}

// CursorImportResult holds the result of a Cursor token import.
type CursorImportResult struct {
	AccessToken string
	MachineID   string
	ExpiresIn   int
	AuthMethod  string
}

// NewCursorService creates a new CursorService.
func NewCursorService() *CursorService {
	cfg := DefaultCursorConfig()
	return &CursorService{
		ClientVersion: cfg.ClientVersion,
		ClientType:    cfg.ClientType,
	}
}

// GenerateChecksum implements the Cursor "jyh cipher" checksum algorithm.
// Algorithm: XOR timestamp bytes with rolling key (initial 165), then base64.
// Format: {encoded_timestamp},{machineId}
func (s *CursorService) GenerateChecksum(machineID string) string {
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	key := byte(165)
	encoded := make([]byte, len(timestamp))
	for i := 0; i < len(timestamp); i++ {
		charCode := timestamp[i]
		encoded[i] = charCode ^ key
		key = key + charCode
	}
	base64Encoded := base64.StdEncoding.EncodeToString(encoded)
	return base64Encoded + "," + machineID
}

// BuildHeaders builds request headers for Cursor API.
func (s *CursorService) BuildHeaders(accessToken, machineID string, ghostMode bool) map[string]string {
	checksum := s.GenerateChecksum(machineID)
	ghostStr := "false"
	if ghostMode {
		ghostStr = "true"
	}
	return map[string]string{
		"Authorization":               "Bearer " + accessToken,
		"Content-Type":                "application/connect+proto",
		"Connect-Protocol-Version":    "1",
		"x-cursor-client-version":     s.ClientVersion,
		"x-cursor-client-type":        s.ClientType,
		"x-cursor-client-os":          s.DetectOS(),
		"x-cursor-client-arch":        s.DetectArch(),
		"x-cursor-client-device-type": "desktop",
		"x-cursor-checksum":           checksum,
		"x-ghost-mode":                ghostStr,
	}
}

// DetectOS returns the OS name for Cursor headers.
func (s *CursorService) DetectOS() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	default:
		return "linux"
	}
}

// DetectArch returns the architecture name for Cursor headers.
func (s *CursorService) DetectArch() string {
	switch runtime.GOARCH {
	case "amd64":
		return "x86_64"
	case "arm64":
		return "aarch64"
	default:
		return runtime.GOARCH
	}
}

// ValidateImportToken validates an imported Cursor token and machine ID.
// Cursor uses complex protobuf format, so we skip API validation — token is
// validated when used for actual requests.
func (s *CursorService) ValidateImportToken(accessToken, machineID string) (*CursorImportResult, error) {
	if accessToken == "" {
		return nil, fmt.Errorf("access token is required")
	}
	if machineID == "" {
		return nil, fmt.Errorf("machine ID is required")
	}
	if len(accessToken) < 50 {
		return nil, fmt.Errorf("invalid token format: token appears too short")
	}

	// Machine ID should be UUID-like (hex + dashes, 32+ chars after removing dashes)
	cleaned := strings.ReplaceAll(machineID, "-", "")
	if !isUUIDLike(cleaned) {
		return nil, fmt.Errorf("invalid machine ID format: expected UUID format")
	}

	return &CursorImportResult{
		AccessToken: accessToken,
		MachineID:   machineID,
		ExpiresIn:   86400, // Cursor tokens typically last 24 hours
		AuthMethod:  "imported",
	}, nil
}

// isUUIDLike checks if a string is hex-only and 32+ chars.
func isUUIDLike(s string) bool {
	if len(s) < 32 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// CursorUserInfo holds extracted user info from a Cursor token.
type CursorUserInfo struct {
	Email  string `json:"email"`
	UserID string `json:"userId"`
}

// ExtractUserInfo attempts to decode a JWT access token and extract user info.
// Returns nil if the token is not a JWT or cannot be decoded.
func (s *CursorService) ExtractUserInfo(accessToken string) *CursorUserInfo {
	parts := strings.Split(accessToken, ".")
	if len(parts) != 3 {
		return nil
	}

	payload := parts[1]
	// Add padding
	for len(payload)%4 != 0 {
		payload += "="
	}

	decoded, err := base64.StdEncoding.DecodeString(
		strings.ReplaceAll(strings.ReplaceAll(payload, "-", "+"), "_", "/"),
	)
	if err != nil {
		return nil
	}

	var claims map[string]any
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return nil
	}

	email, _ := claims["email"].(string)
	userID, _ := claims["sub"].(string)
	if email == "" {
		email = userID
	}
	if userID == "" {
		userID, _ = claims["user_id"].(string)
	}

	if email == "" && userID == "" {
		return nil
	}

	return &CursorUserInfo{
		Email:  email,
		UserID: userID,
	}
}

// CursorTokenStorageInstructions returns user-facing instructions for finding
// the Cursor token in the local SQLite database.
func (s *CursorService) GetTokenStorageInstructions() map[string]any {
	cfg := DefaultCursorConfig()
	return map[string]any{
		"title": "How to get your Cursor token",
		"steps": []string{
			"1. Open Cursor IDE and make sure you're logged in",
			"2. Find the state.vscdb file:",
			"   - Linux: " + cfg.TokenStoragePaths.Linux,
			"   - macOS: " + cfg.TokenStoragePaths.MacOS,
			"   - Windows: " + cfg.TokenStoragePaths.Windows,
			"3. Open the database with SQLite browser or CLI:",
			"   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='cursorAuth/accessToken'\"",
			"4. Also get the machine ID:",
			"   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='storage.serviceMachineId'\"",
			"5. Paste both values in the form below",
		},
		"alternativeMethod": []string{
			"Or use this one-liner to get both values:",
			"sqlite3 state.vscdb \"SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')\"",
		},
	}
}
