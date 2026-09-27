# Face Averager — 3人の顔写真平均合成ツール

3枚の顔写真をブラウザ内でモーフィング合成する静的 Web アプリ。
**通常の合成は全処理がクライアント側**で行われ、顔写真がサーバーに送信されることは一切ありません。

- 公開: https://face-averager.misato-labs.com
- 任意機能の **AI仕上げ**（髪・背景の補完）だけは、ユーザー自身の Gemini APIキーで Google に送信（後述）

## 実行

```sh
python3 -m http.server 8099
# → http://localhost:8099 を開く
# 「サンプル顔写真をセット（3人）」→「3人の顔を合成する」
```

## 仕組み（通常合成）

1. MediaPipe Face Landmarker（WASM）で各画像から478ランドマークを検出
   - 検出閾値は `minFaceDetectionConfidence: 0.3`（古い写真で既定0.5だと0件になるため）
   - GPUデリゲートで0件/例外なら CPU に切り替えて再試行（`detectFace`）
2. 3組のランドマークの平均形状を計算
3. 平均形状を Delaunay 三角分割し、各画像を三角形アフィア変形でワープ
4. 顔凸包＋ガウシアンぼかしのフェザーマスクで、3枚を1/3ずつ加重平均
5. 結果を顔領域で切り抜き、透過 PNG としてダウンロード

依存は CDN のみ（`@mediapipe/tasks-vision` Apache-2.0 / `delaunator` ISC）。ビルド工程はありません。

## AI仕上げ（任意・ユーザー持ち込みAPIキー）

- 合成結果を Gemini の画像編集モデル（既定 `gemini-3.1-flash-image`）に渡し、
  顔の特徴を保持したまま髪・背景を補完した1枚を受け取る
- **同一性保持の工夫（A/B 測定済み）**: プロンプトで「目鼻口・骨格・肌色・向き・表情を変更禁止」と
  明示し、入力を白地に展開したうえで**2倍解像度**で送る（現行プロンプト＋原寸では別人化 2/5、
  ロック＋2倍で 5/5。元写真3枚を参照に付けると逆に暴走するので使わない）
- APIキーはユーザーが [Google AI Studio](https://aistudio.google.com/apikey) で自分で発行し、
  **自分の端末の localStorage にのみ保存**（アプリ運営者はキーを持たない・課金もユーザー自身の枠）
- 送信先は Google の Gemini API のみ。通常合成は従来どおり完全ローカル
- モデルは設定から切替可能（`gemini-3.1-flash-image` / `gemini-2.5-flash-image`（無料枠あり） / `gemini-3-pro-image`）
- テスト: `GEMINI_KEY_FOR_TEST=<key> bun run scratch/verify-ai.ts`
- A/B 比較: `GEMINI_KEY_FOR_TEST=<key> bun run scratch/ab-ai.ts` → `/scratch/ab/`

## デプロイ（Cloudflare Worker 静的アセット）

```sh
export CLOUDFLARE_API_TOKEN="<Cloudflare APIトークン>"
bunx wrangler deploy
```

- `wrangler.jsonc` の `assets.directory: "."` + `.assetsignore` で開発ファイルを除外
- カスタムドメインは `routes` の `custom_domain: true` が DNS・証明書を自動設定
  （トークンに Zone DNS 権限が無くても可。Pages API では不可）

## 検証スクリプト

```sh
bun add -d playwright   # 初回のみ
bun run scratch/verify.ts        # 合成の正常系
bun run scratch/verify-error.ts  # 顔なし画像のエラー系
bun run scratch/verify-ai.ts     # AI仕上げ（キーなし経路＋実キー経路）
```

## サンプル画像のクレジット

`samples/` の4枚は Wikimedia Commons から取得したパブリックドメイン / CC0 の素材:

- `face1_lincoln.jpg` — Abraham Lincoln、Alexander Gardner 撮影（1863年、PD-US）
- `face2_einstein.jpg` — Albert Einstein、Ferdinand Schmutzer 撮影（1921年、PD-US）
- `face3_curie.jpg` — Marie Curie（1920年代、PD-US）
- `noface_landscape.jpg` — モレーン湖の風景（Gorgo、CC0）

各ファイルの詳細なライセンスは Wikimedia Commons の各ファイル頁に従います。

## 利用上の注意

- **実在する第三者の写真を合成する場合は、本人の同意を得て利用してください**（同意なき公開は
  肖像権・パブリシティ権の問題になり得ます）
- AI仕上げの出力は AI 生成物です。AI生成物としての表示義務がある配布先ではその旨を表示してください
- 本ソフトは「現状のまま」提供されます（MIT ライセンス）

## ライセンス

[MIT](./LICENSE)
