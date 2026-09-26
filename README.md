# FaceMix — 3人の顔写真合成ツール

3枚の顔写真をブラウザ内でモーフィング合成する静的 Web アプリ。
**全処理がクライアント側**で行われ、顔写真がサーバーに送信されることは一切ありません。

## 実行

```sh
python3 -m http.server 8099
# → http://localhost:8099 を開く
# 「サンプル顔写真をセット（3人）」→「合成する」
```

## 仕組み

1. MediaPipe Face Landmarker（WASM）で各画像から478ランドマークを検出
2. 3組のランドマークの平均形状を計算
3. 平均形状を Delaunay 三角分割し、各画像を三角形アフィア変形でワープ
4. 顔凸包＋ガウシアンぼかしのフェザーマスクで、3枚を1/3ずつ加重平均
5. 結果を顔領域で切り抜き、透過 PNG としてダウンロード

依存は CDN のみ（`@mediapipe/tasks-vision`, `delaunator`）。ビルド工程はありません。

## デプロイ（Cloudflare Pages）

このディレクトリをそのまま Pages にデプロイするだけ（ビルドコマンド不要、静的ファイルのみ）。

## 検証スクリプト

```sh
bun add -d playwright   # 初回のみ
bun run scratch/verify.ts   # サーバー起動中に実行
```

## サンプル画像

`samples/` の4枚は Wikimedia Commons のパブリックドメイン / CC0（PD-US 等）。
