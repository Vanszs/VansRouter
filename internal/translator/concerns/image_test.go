package concerns

import "testing"

func TestEncodeDataUri(t *testing.T) {
	got := EncodeDataUri("image/png", "aGVsbG8=")
	if got != "data:image/png;base64,aGVsbG8=" {
		t.Errorf("EncodeDataUri = %q", got)
	}
}

func TestEncodeDataUri_DefaultMime(t *testing.T) {
	got := EncodeDataUri("", "aGVsbG8=")
	if got != "data:image/png;base64,aGVsbG8=" {
		t.Errorf("EncodeDataUri empty mime = %q", got)
	}
}

func TestParseDataUri_Valid(t *testing.T) {
	parsed := ParseDataUri("data:image/jpeg;base64,aGVsbG8=")
	if parsed == nil {
		t.Fatal("ParseDataUri returned nil")
	}
	if parsed.MimeType != "image/jpeg" {
		t.Errorf("MimeType = %q, want image/jpeg", parsed.MimeType)
	}
	if parsed.Base64 != "aGVsbG8=" {
		t.Errorf("Base64 = %q, want aGVsbG8=", parsed.Base64)
	}
}

func TestParseDataUri_NotDataUri(t *testing.T) {
	if ParseDataUri("https://example.com/img.png") != nil {
		t.Error("should return nil for non-data URI")
	}
}

func TestParseDataUri_NoBase64(t *testing.T) {
	if ParseDataUri("data:image/png,raw") != nil {
		t.Error("should return nil for non-base64")
	}
}

func TestParseDataUri_InvalidBase64(t *testing.T) {
	if ParseDataUri("data:image/png;base64,!!!invalid!!!") != nil {
		t.Error("should return nil for invalid base64")
	}
}

func TestNormalizeImagePart(t *testing.T) {
	part := map[string]any{"type": "image_url"}
	out := NormalizeImagePart(part, "")
	if out["type"] != "image_url" {
		t.Errorf("type lost")
	}
}
