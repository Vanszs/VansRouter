package concerns

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEncodeDataUri(t *testing.T) {
	tests := []struct {
		name     string
		mime     string
		data     string
		expected string
	}{
		{"png with mime", "image/png", "iVBORw0KGgo=", "data:image/png;base64,iVBORw0KGgo="},
		{"jpeg with mime", "image/jpeg", "/9j/4AAQ=", "data:image/jpeg;base64,/9j/4AAQ="},
		{"empty mime defaults to png", "", "abc123", "data:image/png;base64,abc123"},
		{"empty data", "image/png", "", "data:image/png;base64,"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, EncodeDataUri(tt.mime, tt.data))
		})
	}
}

func TestParseDataUri(t *testing.T) {
	t.Run("valid png data uri", func(t *testing.T) {
		// Use a valid base64 string
		uri := "data:image/png;base64,iVBORw0KGgo="
		parsed := ParseDataUri(uri)
		assert.NotNil(t, parsed)
		assert.Equal(t, "image/png", parsed.MimeType)
		assert.Equal(t, "iVBORw0KGgo=", parsed.Base64)
	})

	t.Run("valid jpeg data uri", func(t *testing.T) {
		// Use a valid base64 string
		uri := "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
		parsed := ParseDataUri(uri)
		if assert.NotNil(t, parsed) {
			assert.Equal(t, "image/jpeg", parsed.MimeType)
			assert.Equal(t, "/9j/4AAQSkZJRg==", parsed.Base64)
		}
	})

	t.Run("not a data uri", func(t *testing.T) {
		parsed := ParseDataUri("https://example.com/image.png")
		assert.Nil(t, parsed)
	})

	t.Run("missing base64 marker", func(t *testing.T) {
		parsed := ParseDataUri("data:image/png,rawdata")
		assert.Nil(t, parsed)
	})

	t.Run("invalid base64", func(t *testing.T) {
		parsed := ParseDataUri("data:image/png;base64,!!!invalid!!!")
		assert.Nil(t, parsed)
	})

	t.Run("empty string", func(t *testing.T) {
		parsed := ParseDataUri("")
		assert.Nil(t, parsed)
	})

	t.Run("empty mime type", func(t *testing.T) {
		uri := "data:;base64,iVBORw0KGgo="
		parsed := ParseDataUri(uri)
		assert.NotNil(t, parsed)
		assert.Equal(t, "", parsed.MimeType)
	})
}

func TestNormalizeImagePart(t *testing.T) {
	t.Run("with mime", func(t *testing.T) {
		part := map[string]any{"type": "image_url", "url": "data:image/png;base64,abc"}
		result := NormalizeImagePart(part, "image/jpeg")
		assert.Equal(t, part, result)
	})

	t.Run("empty mime defaults", func(t *testing.T) {
		part := map[string]any{"type": "image"}
		result := NormalizeImagePart(part, "")
		assert.Equal(t, part, result)
	})

	t.Run("nil part", func(t *testing.T) {
		result := NormalizeImagePart(nil, "image/png")
		// nil map returns nil
		assert.Nil(t, result)
	})
}
