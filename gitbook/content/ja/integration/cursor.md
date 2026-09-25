# Cursor統合

VansRouterをCursor IDEと統合し、AIリクエストをVansRouterのインテリジェントルーティングシステム経由でルーティングします。

## 前提条件

- Cursor IDEがインストール済み
- Cursor Proアカウント (カスタムAPIエンドポイントに必要)
- VansRouterクラウドエンドポイントが設定済み
- VansRouterダッシュボードからのAPIキー

## ⚠️ 重要な注意点

> **クラウドエンドポイントが必要**: Cursorは独自のサーバー経由でリクエストをルーティングし、localhostエンドポイントをサポートしません。VansRouterクラウドエンドポイント `https://vansrouter.example` を使用する必要があります。

> **Cursor Proが必要**: この機能はカスタムAPIエンドポイントを使用するためにCursor Proアカウントが必要です。

## セットアップ

### 1. Cursor設定を開く

1. Cursor IDEを開く
2. **Settings** へ移動 (Cmd/Ctrl + ,)
3. **Models** セクションへ移動

### 2. OpenAI APIを有効化

1. **OpenAI API key** オプションを見つける
2. トグルを有効にしてカスタムAPI設定を有効化

### 3. Base URLを設定

Base URLをVansRouterクラウドエンドポイントに設定:

```
https://vansrouter.example
```

**手順:**
1. Models設定で **Base URL** フィールドを見つける
2. 入力: `https://vansrouter.example`
3. **Save** をクリック

### 4. APIキーを追加

1. **API Key** フィールドにVansRouter APIキーを入力
2. APIキーはVansRouterダッシュボードの **Settings → API Keys** で確認できます
3. **Save** をクリック

### 5. カスタムモデルを追加

1. **View All Models** ボタンをクリック
2. **Add Custom Model** をクリック
3. VansRouter設定からモデル名を入力 (例: `gpt-4`、`claude-opus-4-5` など)
4. **Add** をクリック

### 6. モデルを選択

1. Cursorチャットインターフェイスでモデルセレクタードロップダウンをクリック
2. リストからカスタムモデルを選択
3. CursorでVansRouterを使い始める!

## 設定例

Cursor設定は次のようになります:

```
OpenAI API: ✓ Enabled
Base URL: https://vansrouter.example
API Key: sk-your-key-xxxxxxxxxxxxx
Custom Models: gpt-4, claude-opus-4-5, gemini-2.0-flash
```

## 利用可能なモデル

VansRouterダッシュボードで設定されたモデルを使用できます。一般的な例:

| モデル名 | プロバイダー | 説明 |
|------------|----------|-------------|
| `gpt-4` | OpenAI | GPT-4 Turbo |
| `gpt-4o` | OpenAI | GPT-4 Optimized |
| `claude-opus-4-5` | Anthropic | Claude Opus 4.5 |
| `claude-sonnet-4-5` | Anthropic | Claude Sonnet 4.5 |
| `gemini-2.0-flash` | Google | Gemini 2.0 Flash |

## 使用法

### チャットインターフェイス

1. Cursorチャットを開く (Cmd/Ctrl + L)
2. ドロップダウンからモデルを選択
3. VansRouter経由でAIとチャット開始

### インラインコード生成

1. エディタでコードを選択
2. Cmd/Ctrl + Kを押す
3. プロンプトを入力
4. CursorはVansRouterを使用してコードを生成

### コード説明

1. エディタでコードを選択
2. Cmd/Ctrl + Lを押す
3. 「Explain this code」と質問
4. VansRouter経由でAIによる説明を取得

## トラブルシューティング

### 「Invalid API Key」エラー

1. VansRouterダッシュボードでAPIキーを確認
2. `sk-your-key-` プレフィックスを含むキー全体をコピーしたか確認
3. APIキーが期限切れでないか確認
4. 新しいAPIキーを再生成してみる

### 「Model Not Found」エラー

1. モデル名がVansRouter設定と正確に一致するか確認
2. VansRouterダッシュボードでプロバイダー接続がアクティブか確認
3. 接続されたプロバイダーでモデルが利用可能か確認
4. フルモデル名を使用してみる (例: `gpt-4` の代わりに `openai/gpt-4`)

### 接続の問題

1. クラウドエンドポイントを使用しているか確認: `https://vansrouter.example`
2. インターネット接続を確認
3. VansRouterクラウドサービスが運用中か確認
4. VPNまたはプロキシが有効な場合は無効化してみる

### Localhostが動作しない

> **覚えておいてください**: Cursorはlocalhostエンドポイントをサポートしません。クラウドエンドポイント `https://vansrouter.example` を使用する必要があります。ローカルVansRouterインスタンスを使用したい場合は、ngrokなどのトンネリングサービスを検討してローカルエンドポイントを公開してください。

## クラウドエンドポイントのセットアップ

ローカルでVansRouterを実行し、Cursorで使用したい場合:

1. VansRouter設定でクラウドエンドポイントを有効化
2. VansRouterダッシュボードでクラウドエンドポイントURLを設定
3. Cursor設定でクラウドURLを使用
4. ローカルVansRouterインスタンスがインターネットからアクセス可能か確認

## ベストプラクティス

1. **モデルエイリアスを使用**: VansRouterで頻繁に使うモデル用のショートエイリアスを作成
2. **使用量をモニター**: VansRouterダッシュボードで使用統計とコストを確認
3. **APIキーをローテーション**: セキュリティのためAPIキーを定期的にローテーション
4. **モデルをテスト**: ユースケースに最適なモデルを見つけるため、異なるモデルを試す
