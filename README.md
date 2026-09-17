# Vonage Keypad

Vonage Client SDK と Vonage Cloud Runtime (VCR) を使用し、ブラウザから電話番号へ発信する最小構成のダイヤラーです。

## 主な機能

- ブラウザのマイクを使用した App-to-Phone 発信
- キーパッドおよび物理キーボードからの番号入力
- Vonage アカウントで保有する番号を取得し、発信元番号として選択
- 着信時に「オペレーターへ接続できない」旨の音声案内を再生
- VCR シークレットを使用したダッシュボードの Basic 認証
- Client SDK ユーザーの自動作成と短時間 JWT の発行

## 免責事項

このサンプルコードは参考目的のみで提供されています。  
動作保証・本番対応・セキュリティ保証はありません。  
実際の運用前に必ず自身で検証・テスト・強化を行ってください。

## 前提条件

- Vonage API アカウント
- Node.js 22 以上
- npm
- VCR CLI
- 発信に使用できる Vonage 番号

Vonage API キーと API シークレットは [Vonage API Dashboard](https://dashboard.nexmo.com/settings) で確認できます。

## VCR へのセットアップ

### 1. リポジトリを取得

```sh
git clone https://github.com/arnaud-vonage/vonage-keypad.git
cd vonage-keypad
npm install
```

### 2. VCR CLI をインストール

```sh
npm install -g @vonage/vcr
vcr --version
```

### 3. VCR CLI を認証

```sh
vcr configure
```

画面の指示に従い、Vonage API キー、API シークレット、利用する VCR リージョンを入力します。このアプリのサンプル設定はシンガポールの `aws.apse1` を使用します。

### 4. Voice/RTC アプリケーションを作成

```sh
vcr app create --name vonage-keypad --voice --rtc --yes
```

出力された Application ID を控えてください。既存の Vonage Application を使う場合は Voice と RTC の両方が有効であることを確認します。

### 5. VCR マニフェストを作成

実際の `vcr.yml` は Application ID を含むため Git 管理されません。サンプルから作成します。

```sh
cp vcr.example.yml vcr.yml
```

`vcr.yml` の `instance.application-id` と `debug.application-id` に、手順 4 の Application ID を設定します。

```yaml
application-id: "YOUR_APPLICATION_ID"
```

本番インスタンスとデバッグで同じ Application ID を使用すると、`vcr debug` 実行時に確認メッセージが表示されます。本番トラフィックがある場合は、デバッグ専用 Application を作成して `debug.application-id` に設定してください。

### 6. ダッシュボード認証情報を VCR シークレットへ登録

値をコマンド履歴に残さないため、`--value` を付けずに実行する方法を推奨します。

```sh
vcr secret create --name USERNAME
vcr secret create --name PASSWORD
```

各コマンドで値を入力し、`Ctrl+D` で保存します。シークレット名は `vcr.yml` から参照され、平文の認証情報はソースコードやマニフェストに保存されません。

既存の値を変更する場合は次を使用します。

```sh
vcr secret update --name USERNAME
vcr secret update --name PASSWORD
```

### 7. アプリケーションキーを準備

VCR CLI で作成した Application では通常自動設定されます。認証エラーが発生する場合や Dashboard で作成した Application を使う場合は、次を実行します。

```sh
vcr app generate-keys --app-id YOUR_APPLICATION_ID
```

秘密鍵は VCR から実行環境へ注入されます。リポジトリへ秘密鍵を追加しないでください。

### 8. ローカルデバッグ

```sh
vcr debug
```

確認を省略する場合は次を使用します。

```sh
vcr debug --yes
```

表示された `Application Host` をブラウザで開き、手順 6 のユーザー名とパスワードを入力します。

前回のデバッグが異常終了し、`maximum debug session limit` が表示された場合は次を実行します。

```sh
vcr debug prune-sessions
```

`listen tcp :3001: bind: address already in use` の場合は、別の `vcr debug` プロセスを終了してから再実行してください。

### 9. VCR へデプロイ

```sh
vcr deploy
```

デプロイ完了時に表示される URL をブラウザで開き、手順 6 の認証情報でログインします。

## VCR を使用しないローカル実行

Vonage から `localhost` へ直接 Webhook を送ることはできないため、ngrok などの HTTPS トンネルを使用します。VCR 用 Application の Callback Router 設定を上書きしないよう、Voice と RTC を有効にしたローカル開発専用の Vonage Application を使用してください。

1. `.env.example` を `.env` にコピーし、API キー、API シークレット、ローカル用 Application ID、Basic 認証情報を設定します。
2. ローカル用 Application の秘密鍵を `private.key` として配置します。
3. アプリとトンネルを起動します。

```sh
cp .env.example .env
npm run local
ngrok http 3000
```

4. ローカル用 Vonage Application の Voice Webhook を、ngrok が表示した HTTPS URL に設定します。

```text
Answer URL: https://YOUR-NGROK-HOST/answer  (POST)
Event URL:  https://YOUR-NGROK-HOST/event   (POST)
```

ブラウザでは同じ ngrok URL を開きます。トンネル URL が変わった場合は Application の Webhook URL も更新してください。ローカルモードでは VCR Callback Router への登録を行わず、`.env` の Application ID と秘密鍵で Client SDK JWT を生成します。

## 使用方法

1. ブラウザでダッシュボードを開き、Basic 認証を行います。
2. マイクの利用をブラウザで許可します。
3. `Call from` から、アカウントで保有する発信元番号を選択します。
4. 国番号を含む番号を `+` なしで入力します（例: `819012345678`）。
5. `Call` を押して発信します。通話中は同じボタンで切断できます。

保有番号は Vonage Numbers API から取得され、5 分間キャッシュされます。サーバーは発信時にも選択番号がアカウント保有番号か検証します。

## 着信時の動作

Vonage 番号への通常着信では外部オペレーターへ転送せず、次の英語案内を再生して終了します。

> The operators cannot be joined at this number.

Client SDK からの発信では、`custom_data` に含まれる宛先と発信元を検証し、Phone エンドポイントへ接続する NCCO を返します。

## 認証と公開エンドポイント

次のリソースは Basic 認証で保護されます。

- ダッシュボードと静的アセット
- `/numbers`（保有番号一覧）
- `/session`（Client SDK JWT 発行）

Vonage/VCR から到達する必要があるため、次のエンドポイントは Basic 認証の対象外です。

- `GET /_/health`
- `POST /answer`
- `POST /event`

Basic 認証は簡易的なアクセス制御です。本番利用では、組織の SSO、アクセス制限、Webhook 検証、監査ログ、レート制限などを追加してください。

## 設定と生成ファイル

- `vcr.example.yml`: Git 管理される安全なテンプレート
- `vcr.yml`: 実際の Application ID を含むローカル設定（Git 対象外）
- `src/app.js`: ブラウザコードの編集元
- `public/app.js`: `npm run build` で生成されるバンドル（Git 対象外）

ブラウザバンドルを生成するには次を実行します。

```sh
npm run build
```

## トラブルシューティング

### ブラウザが `Connecting...` のままになる

- Application で RTC が有効か確認します。
- `vcr app generate-keys` を実行し、デバッグセッションを再作成します。
- WebSocket 通信を遮断するプロキシやファイアウォールがないか確認します。

### 発信元番号が表示されない

- Vonage アカウントに番号があるか確認します。
- VCR CLI の API キー/シークレットが対象アカウントのものか確認します。
- 選択した番号で Voice 発信が許可されているか確認します。

### Answer Webhook が 404 になる

アプリが `POST /answer` を処理していること、VCR デバッグまたはデプロイが最新コードで再起動されていることを確認します。

## セキュリティ上の注意

- API シークレット、秘密鍵、ダッシュボード認証情報を Git にコミットしないでください。
- `vcr.yml` は `.gitignore` 対象です。共有する場合は `vcr.example.yml` を使用してください。
- `/session` の JWT は 15 分で期限切れになります。
- 発信元番号はサーバー側で保有番号一覧と照合されます。
- デバッグ URL と認証情報を第三者へ共有しないでください。

## ライセンス

このプロジェクトは MIT License のもとで提供されています。詳細は [LICENSE](LICENSE) を参照してください。