package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/9router/9router/internal/db/repos"
	"github.com/9router/9router/internal/providers"
	"github.com/9router/9router/internal/providers/executors"
	"github.com/9router/9router/internal/translator"
)

// ChatServiceImpl implements ChatService: resolve → translate → execute → translate back.
type ChatServiceImpl struct {
	Registry *providers.Registry
	Accounts *repos.AccountsRepo
}

// NewChatServiceImpl creates a fully-wired ChatService.
func NewChatServiceImpl(registry *providers.Registry, accounts *repos.AccountsRepo) *ChatServiceImpl {
	return &ChatServiceImpl{Registry: registry, Accounts: accounts}
}

// Chat executes a full chat completion pipeline.
func (s *ChatServiceImpl) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	body := req.Body
	modelStr, _ := body["model"].(string)
	stream, _ := body["stream"].(bool)

	// 1. Resolve model → provider + upstream model + format
	providerID, upstreamModel, targetFormat, err := s.resolveModel(modelStr)
	if err != nil {
		return nil, fmt.Errorf("model resolution: %w", err)
	}

	// 2. Get credentials
	accts, err := s.Accounts.List(providerID, boolPtr(true))
	if err != nil || len(accts) == 0 {
		// Fallback: try without provider filter (provider ID might be an alias)
		accts, err = s.Accounts.List("", boolPtr(true))
		if err != nil || len(accts) == 0 {
			return nil, fmt.Errorf("no active credentials for provider %q", providerID)
		}
	}
	acct := accts[0]

	creds := buildCredentials(acct)

	// 3. Translate request if format differs from OpenAI
	sourceFormat := translator.FormatOpenAI
	if translator.NeedsTranslation(sourceFormat, targetFormat) {
		body, err = translator.TranslateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, nil)
		if err != nil {
			return nil, fmt.Errorf("translate request: %w", err)
		}
	} else {
		body["model"] = upstreamModel
	}

	// 4. Execute upstream
	providerCfg := s.buildProviderConfig(providerID)
	execReq := executors.ExecuteRequest{
		Model:       upstreamModel,
		Body:        body,
		Stream:      stream,
		Credentials: creds,
	}
	resp, err := executors.Execute(ctx, providerID, providerCfg, execReq)
	if err != nil {
		return nil, fmt.Errorf("execute upstream: %w", err)
	}

	// 5. Translate response (non-streaming only; streaming passes through raw SSE)
	if !stream && translator.NeedsTranslation(sourceFormat, targetFormat) {
		return s.translateResponse(resp, targetFormat, sourceFormat, upstreamModel)
	}

	// Pass through
	return &ChatResponse{
		StatusCode:  resp.StatusCode,
		ContentType: resp.Header.Get("Content-Type"),
		Headers:     resp.Header,
		Body:        resp.Body,
	}, nil
}

// resolveModel maps a model string to provider ID + upstream model + translator format.
func (s *ChatServiceImpl) resolveModel(modelStr string) (providerID, upstreamModel string, format translator.Format, err error) {
	if s.Registry == nil {
		return "", "", "", fmt.Errorf("provider registry not available")
	}

	// Try provider registry lookup (model may be a provider alias)
	resolvedID := providers.ResolveProviderId(s.Registry, modelStr)
	if resolvedID != "" {
		_, ok := s.Registry.Providers[resolvedID]
		if ok {
			transport := providers.ResolveTransport(resolvedID, "openai", s.Registry)
			f := "openai"
			if transport != nil && transport.Format != "" {
				f = transport.Format
			}
			return resolvedID, modelStr, translator.Format(f), nil
		}
	}

	// Detect from model name prefix
	pid, um := detectProviderFromModel(modelStr)
	f := formatForProvider(pid, s.Registry)
	return pid, um, translator.Format(f), nil
}

func detectProviderFromModel(model string) (string, string) {
	lower := strings.ToLower(model)
	switch {
	case strings.HasPrefix(lower, "claude"):
		return "anthropic", model
	case strings.HasPrefix(lower, "gemini"):
		return "gemini", model
	case strings.HasPrefix(lower, "gpt") || strings.HasPrefix(lower, "o1") || strings.HasPrefix(lower, "o3") || strings.HasPrefix(lower, "o4"):
		return "openai", model
	case strings.HasPrefix(lower, "llama") || strings.HasPrefix(lower, "mistral") || strings.HasPrefix(lower, "qwen") || strings.HasPrefix(lower, "codellama"):
		return "ollama", model
	default:
		return "openai", model
	}
}

func formatForProvider(providerID string, reg *providers.Registry) string {
	if reg != nil {
		transport := providers.ResolveTransport(providerID, "openai", reg)
		if transport != nil && transport.Format != "" {
			return transport.Format
		}
	}
	switch providerID {
	case "anthropic":
		return "claude"
	case "gemini", "vertex":
		return "gemini"
	case "ollama":
		return "ollama"
	default:
		return "openai"
	}
}

func buildCredentials(acct *repos.Account) executors.Credentials {
	creds := executors.Credentials{}
	if acct.APIKey != "" {
		creds.APIKey = acct.APIKey
	} else if acct.AccessToken != "" {
		creds.AccessToken = acct.AccessToken
		creds.RefreshToken = acct.RefreshToken
	}
	if acct.ProviderSpecificData != nil {
		creds.ProviderSpecificData = acct.ProviderSpecificData
	} else if acct.Data != nil {
		creds.ProviderSpecificData = acct.Data
	}
	return creds
}

func (s *ChatServiceImpl) buildProviderConfig(providerID string) *executors.ProviderConfig {
	cfg := &executors.ProviderConfig{}
	if s.Registry == nil {
		return cfg
	}
	transport := providers.ResolveTransport(providerID, "openai", s.Registry)
	if transport != nil {
		cfg.BaseUrl = transport.BaseURL
		cfg.Format = transport.Format
	}
	return cfg
}

func (s *ChatServiceImpl) translateResponse(resp *http.Response, targetFormat, sourceFormat translator.Format, model string) (*ChatResponse, error) {
	respBody, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var chunk map[string]any
	if err := json.Unmarshal(respBody, &chunk); err != nil {
		// Not JSON — pass through
		return makeJSONResponse(resp.StatusCode, respBody), nil
	}

	state := translator.InitState(sourceFormat)
	state.Model = model
	translated, err := translator.TranslateResponse(targetFormat, sourceFormat, chunk, state)
	if err != nil {
		// Translation failed — pass through raw
		return makeJSONResponse(resp.StatusCode, respBody), nil
	}
	if len(translated) > 0 {
		outBytes, _ := json.Marshal(translated[0])
		return makeJSONResponse(resp.StatusCode, outBytes), nil
	}
	return makeJSONResponse(resp.StatusCode, respBody), nil
}

func makeJSONResponse(status int, body []byte) *ChatResponse {
	headers := make(http.Header)
	headers.Set("Content-Type", "application/json")
	return &ChatResponse{
		StatusCode:  status,
		ContentType: "application/json",
		Headers:     headers,
		Body:        io.NopCloser(bytes.NewReader(body)),
	}
}

func boolPtr(b bool) *bool { return &b }
