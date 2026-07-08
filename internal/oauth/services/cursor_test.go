package services

import (
	"testing"
)

func TestCursorGenerateChecksum_Format(t *testing.T) {
	s := NewCursorService()
	cs := s.GenerateChecksum("machine-123")
	if cs == "" {
		t.Fatal("checksum should not be empty")
	}
	// Format: {base64},{machineId}
	parts := splitOnLast(cs, ",")
	if len(parts) != 2 {
		t.Fatalf("checksum should contain comma: %s", cs)
	}
	if parts[1] != "machine-123" {
		t.Errorf("machine ID should be last part, got: %s", parts[1])
	}
}

func TestCursorGenerateChecksum_DifferentTimestamps(t *testing.T) {
	s := NewCursorService()
	cs1 := s.GenerateChecksum("machine-1")
	cs2 := s.GenerateChecksum("machine-2")
	if cs1 == cs2 {
		t.Error("checksums for different machine IDs should differ")
	}
}

func TestCursorBuildHeaders(t *testing.T) {
	s := NewCursorService()
	h := s.BuildHeaders("token123", "machine-456", false)

	if h["Authorization"] != "Bearer token123" {
		t.Errorf("wrong Authorization: %s", h["Authorization"])
	}
	if h["Content-Type"] != "application/connect+proto" {
		t.Errorf("wrong Content-Type: %s", h["Content-Type"])
	}
	if h["Connect-Protocol-Version"] != "1" {
		t.Errorf("wrong Connect-Protocol-Version: %s", h["Connect-Protocol-Version"])
	}
	if h["x-cursor-client-version"] == "" {
		t.Error("client version should not be empty")
	}
	if h["x-cursor-checksum"] == "" {
		t.Error("checksum should not be empty")
	}
	if h["x-ghost-mode"] != "false" {
		t.Errorf("ghost mode should be false: %s", h["x-ghost-mode"])
	}

	hGhost := s.BuildHeaders("token123", "machine-456", true)
	if hGhost["x-ghost-mode"] != "true" {
		t.Errorf("ghost mode should be true: %s", hGhost["x-ghost-mode"])
	}
}

func TestCursorDetectOS(t *testing.T) {
	s := NewCursorService()
	os := s.DetectOS()
	valid := map[string]bool{"windows": true, "macos": true, "linux": true}
	if !valid[os] {
		t.Errorf("unexpected OS: %s", os)
	}
}

func TestCursorDetectArch(t *testing.T) {
	s := NewCursorService()
	arch := s.DetectArch()
	if arch == "" {
		t.Error("arch should not be empty")
	}
}

func TestCursorValidateImportToken_Valid(t *testing.T) {
	s := NewCursorService()
	// Use a 50+ char token and a UUID-like machine ID
	token := "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789"
	machineID := "aabbccdd-eeff-0011-2233-445566778899"

	result, err := s.ValidateImportToken(token, machineID)
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	if result.AccessToken != token {
		t.Error("access token mismatch")
	}
	if result.MachineID != machineID {
		t.Error("machine ID mismatch")
	}
	if result.ExpiresIn != 86400 {
		t.Errorf("expected 86400, got %d", result.ExpiresIn)
	}
	if result.AuthMethod != "imported" {
		t.Errorf("expected 'imported', got %s", result.AuthMethod)
	}
}

func TestCursorValidateImportToken_EmptyToken(t *testing.T) {
	s := NewCursorService()
	_, err := s.ValidateImportToken("", "machine-123")
	if err == nil {
		t.Fatal("should error on empty token")
	}
}

func TestCursorValidateImportToken_EmptyMachineID(t *testing.T) {
	s := NewCursorService()
	_, err := s.ValidateImportToken("abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789", "")
	if err == nil {
		t.Fatal("should error on empty machine ID")
	}
}

func TestCursorValidateImportToken_ShortToken(t *testing.T) {
	s := NewCursorService()
	_, err := s.ValidateImportToken("short", "aabbccdd-eeff-0011-2233-445566778899")
	if err == nil {
		t.Fatal("should error on short token")
	}
}

func TestCursorValidateImportToken_InvalidMachineID(t *testing.T) {
	s := NewCursorService()
	token := "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789"
	_, err := s.ValidateImportToken(token, "not-a-uuid")
	if err == nil {
		t.Fatal("should error on invalid machine ID")
	}
}

func TestCursorExtractUserInfo_NonJWT(t *testing.T) {
	s := NewCursorService()
	result := s.ExtractUserInfo("not-a-jwt")
	if result != nil {
		t.Error("should return nil for non-JWT token")
	}
}

func TestCursorGetTokenStorageInstructions(t *testing.T) {
	s := NewCursorService()
	instr := s.GetTokenStorageInstructions()
	if instr == nil {
		t.Fatal("instructions should not be nil")
	}
	if _, ok := instr["title"]; !ok {
		t.Error("instructions should have title")
	}
	if _, ok := instr["steps"]; !ok {
		t.Error("instructions should have steps")
	}
}

// Helper: split on last separator
func splitOnLast(s, sep string) []string {
	idx := -1
	for i := len(s) - 1; i >= 0; i-- {
		if string(s[i]) == sep {
			idx = i
			break
		}
	}
	if idx == -1 {
		return []string{s}
	}
	return []string{s[:idx], s[idx+1:]}
}
