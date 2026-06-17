---
inclusion: always
---
# API Keys & Test Credentials

> File ini di-gitignore. Jangan commit.

## 9Router (local)
- **Base URL**: `http://localhost:3003/v1`
- **API Key (dashboard)**: `sk-3f68432058f6317c-f5afxg-81892e14`

## NVIDIA NIM
- **API Key**: `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`
- **Base URL**: `https://integrate.api.nvidia.com/v1`
- **Test model**: `moonshotai/kimi-k2.6`

## Test curl cepat
```bash
# Test tool call via NVIDIA langsung
curl -s https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer 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" \
  -H "Content-Type: application/json" \
  -d '{"model":"moonshotai/kimi-k2.6","messages":[{"role":"user","content":"hi"}],"max_tokens":50}'

# Test via 9Router local
curl -s http://localhost:3003/v1/chat/completions \
  -H "Authorization: Bearer sk-3f68432058f6317c-f5afxg-81892e14" \
  -H "Content-Type: application/json" \
  -d '{"model":"nvidia/moonshotai/kimi-k2.6","messages":[{"role":"user","content":"hi"}]}'
```
