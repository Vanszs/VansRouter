# Tích hợp Cursor

Tích hợp VansRouter với Cursor IDE để định tuyến request AI qua hệ thống routing thông minh của VansRouter.

## Yêu cầu

- Cursor IDE đã cài đặt
- Tài khoản Cursor Pro (cần thiết cho custom API endpoint)
- VansRouter cloud endpoint đã cấu hình
- API key từ VansRouter dashboard

## ⚠️ Lưu ý Quan trọng

> **Yêu cầu Cloud Endpoint**: Cursor định tuyến request qua server của chính nó và không hỗ trợ endpoint localhost. Bạn phải dùng VansRouter cloud endpoint: `https://vansrouter.example`

> **Yêu cầu Cursor Pro**: Tính năng này yêu cầu tài khoản Cursor Pro để dùng custom API endpoint.

## Setup

### 1. Mở Cursor Settings

1. Mở Cursor IDE
2. Đi đến **Settings** (Cmd/Ctrl + ,)
3. Đi đến phần **Models**

### 2. Bật OpenAI API

1. Tìm option **OpenAI API key**
2. Bật toggle để kích hoạt cấu hình custom API

### 3. Cấu hình Base URL

Đặt base URL tới VansRouter cloud endpoint:

```
https://vansrouter.example
```

**Các bước:**
1. Trong cài đặt Models, tìm field **Base URL**
2. Nhập: `https://vansrouter.example`
3. Click **Save**

### 4. Thêm API Key

1. Trong field **API Key**, nhập API key VansRouter
2. Bạn có thể tìm API key trong VansRouter dashboard tại **Settings → API Keys**
3. Click **Save**

### 5. Thêm Custom Model

1. Click nút **View All Models**
2. Click **Add Custom Model**
3. Nhập tên model từ cấu hình VansRouter (ví dụ: `gpt-4`, `claude-opus-4-5`, v.v.)
4. Click **Add**

### 6. Chọn Model

1. Trong giao diện chat Cursor, click dropdown chọn model
2. Chọn custom model từ danh sách
3. Bắt đầu dùng VansRouter với Cursor!

## Ví dụ Cấu hình

Cursor settings của bạn nên trông như sau:

```
OpenAI API: ✓ Enabled
Base URL: https://vansrouter.example
API Key: sk-your-key-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## Model có sẵn

Bạn có thể dùng bất kỳ model nào đã cấu hình trong VansRouter dashboard. Ví dụ phổ biến:

| Tên Model | Provider | Mô tả |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## Sử dụng

### Giao diện Chat

1. Mở Cursor chat (Cmd/Ctrl + L)
2. Chọn model từ dropdown
3. Bắt đầu chat với AI qua VansRouter

### Tạo Code Inline

1. Chọn code trong editor
2. Nhấn Cmd/Ctrl + K
3. Nhập prompt
4. Cursor sẽ dùng VansRouter để tạo code

### Giải thích Code

1. Chọn code trong editor
2. Nhấn Cmd/Ctrl + L
3. Hỏi "Explain this code"
4. Nhận giải thích AI qua VansRouter

## Troubleshooting

### Lỗi "Invalid API Key"

1. Xác minh API key trong VansRouter dashboard
2. Đảm bảo bạn sao chép đầy đủ key bao gồm prefix `sk-your-key-`
3. Kiểm tra API key chưa hết hạn
4. Thử tạo API key mới

### Lỗi "Model Not Found"

1. Xác minh tên model khớp chính xác với cấu hình VansRouter
2. Kiểm tra kết nối provider đang hoạt động trong VansRouter dashboard
3. Đảm bảo model có sẵn trong các provider đã kết nối
4. Thử dùng tên model đầy đủ (ví dụ: `openai/gpt-4` thay vì `gpt-4`)

### Lỗi Connection

1. Xác minh bạn đang dùng cloud endpoint: `https://vansrouter.example`
2. Kiểm tra kết nối internet
3. Đảm bảo dịch vụ VansRouter cloud đang hoạt động
4. Thử tắt VPN hoặc proxy nếu đang bật

### Localhost không hoạt động

> **Nhớ**: Cursor không hỗ trợ endpoint localhost. Bạn phải dùng cloud endpoint `https://vansrouter.example`. Nếu cần dùng VansRouter cục bộ, hãy cân nhắc dùng dịch vụ tunneling như ngrok để expose endpoint cục bộ.

## Setup Cloud Endpoint

Nếu bạn chạy VansRouter cục bộ và muốn dùng với Cursor:

1. Bật cloud endpoint trong VansRouter settings
2. Cấu hình URL cloud endpoint trong VansRouter dashboard
3. Dùng URL cloud trong Cursor settings
4. Đảm bảo VansRouter instance cục bộ có thể truy cập từ internet

## Best Practices

1. **Dùng Model Aliases**: Tạo alias ngắn cho model thường dùng trong VansRouter
2. **Theo dõi Usage**: Kiểm tra VansRouter dashboard để xem thống kê và chi phí
3. **Xoay API Key**: Định kỳ xoay API key để bảo mật
4. **Test Model**: Thử các model khác nhau để tìm model tốt nhất cho use case
