package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/9router/9router/backend/internal/models"
	"github.com/9router/9router/backend/internal/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeSource struct {
	combos      []models.Combo
	connections []models.Connection
	custom      []models.CustomModel
	aliases     map[string]string
	disabled    map[string][]string
}

func (f *fakeSource) Combos(context.Context) ([]models.Combo, error)         { return f.combos, nil }
func (f *fakeSource) Connections(context.Context) ([]models.Connection, error) { return f.connections, nil }
func (f *fakeSource) CustomModels(context.Context) ([]models.CustomModel, error) {
	return f.custom, nil
}
func (f *fakeSource) ModelAliases(context.Context) (map[string]string, error) { return f.aliases, nil }
func (f *fakeSource) DisabledByAlias(context.Context) (map[string][]string, error) {
	return f.disabled, nil
}

func loadTestRegistry(t *testing.T) *providers.Registry {
	t.Helper()
	reg, err := providers.LoadRegistry(filepath.Join("..", "..", "..", "data", "providers.json"))
	require.NoError(t, err)
	return reg
}

func idsFromBody(t *testing.T, body []byte) []string {
	t.Helper()
	var resp struct {
		Object string `json:"object"`
		Data   []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			OwnedBy string `json:"owned_by"`
			Kind    string `json:"kind"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(body, &resp))
	assert.Equal(t, "list", resp.Object)
	out := make([]string, len(resp.Data))
	for i, m := range resp.Data {
		assert.Equal(t, "model", m.Object)
		out[i] = m.ID
	}
	sort.Strings(out)
	return out
}

func TestModelsEndpoint(t *testing.T) {
	reg := loadTestRegistry(t)
	src := &fakeSource{
		combos: []models.Combo{
			{ID: "c1", Name: "coding", Kind: "llm"},
		},
	}
	builder := models.NewBuilder(reg, src)
	handler := ModelsHandler(builder)

	t.Run("returns OpenAI list shape with combos and free providers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

		ids := idsFromBody(t, rec.Body.Bytes())
		assert.Contains(t, ids, "combo/coding")
		// At least one free provider from the registry should be present.
		assert.NotEmpty(t, ids)
	})

	t.Run("kind filter narrows the list", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/models?kind=webSearch", nil)
		rec := httptest.NewRecorder()
		handler(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		ids := idsFromBody(t, rec.Body.Bytes())
		for _, id := range ids {
			// Either a web-search pseudo-model or a combo whose name contains "search"
			if strings.HasPrefix(id, "combo/") {
				assert.Contains(t, strings.ToLower(id), "search")
			}
		}
	})

	t.Run("disabled model is omitted", func(t *testing.T) {
		disabledSrc := &fakeSource{
			combos: []models.Combo{
				{ID: "c1", Name: "alpha", Kind: "llm"},
			},
			disabled: map[string][]string{"oc": {"gpt-4o"}},
		}
		disabledBuilder := models.NewBuilder(reg, disabledSrc)
		h := ModelsHandler(disabledBuilder)

		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		rec := httptest.NewRecorder()
		h(rec, req)

		ids := idsFromBody(t, rec.Body.Bytes())
		assert.NotContains(t, ids, "oc/gpt-4o")
	})

	t.Run("deduplicates across sources", func(t *testing.T) {
		dedupSrc := &fakeSource{
			combos: []models.Combo{{ID: "c1", Name: "x", Kind: "llm"}},
			custom: []models.CustomModel{{ID: "alpha", ProviderAlias: "oc", Type: "llm"}},
		}
		b := models.NewBuilder(reg, dedupSrc)
		h := ModelsHandler(b)

		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		rec := httptest.NewRecorder()
		h(rec, req)

		body := rec.Body.String()
		assert.Equal(t, 1, strings.Count(body, `"id":"combo/x"`))
	})

	t.Run("empty registry returns empty list", func(t *testing.T) {
		emptyReg := &providers.Registry{Providers: map[string]providers.Provider{}}
		b := models.NewBuilder(emptyReg, &fakeSource{})
		h := ModelsHandler(b)

		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		rec := httptest.NewRecorder()
		h(rec, req)

		assert.Equal(t, http.StatusOK, rec.Code)
		ids := idsFromBody(t, rec.Body.Bytes())
		assert.Empty(t, ids)
	})
}

func TestParseKindFilter(t *testing.T) {
	cases := []struct {
		raw  string
		want []models.Kind
	}{
		{"", nil},
		{"  ", nil},
		{"llm", []models.Kind{models.KindLLM}},
		{"llm,embedding", []models.Kind{KindLLM, models.KindEmbedding}},
		{"llm, llm , ", []models.Kind{KindLLM, KindLLM}},
	}
	for _, c := range cases {
		got := parseKindFilter(c.raw)
		if c.want == nil {
			assert.Nil(t, got)
		} else {
			assert.Equal(t, c.want, got)
		}
	}
}

// KindLLM is the models.KindLLM value aliased for clarity in the test.
const KindLLM = models.KindLLM
