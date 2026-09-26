import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const KEY = process.env.GEMINI_KEY_FOR_TEST || "";
if (!KEY) { console.error("GEMINI_KEY_FOR_TEST missing"); process.exit(1); }

const OUT = "scratch/ab";
mkdirSync(OUT, { recursive: true });

const PROMPT_BASE =
  "この画像は3人の顔を機械的に平均して合成したものです。顔の特徴・表情・向き・肌の色合いは変えずに、自然な1枚の肖像写真へ仕上げてください。髪型と背景はこの顔に似合う自然なものを補完してください。合成由来の歪みやゴーストがあれば解消してください。";

const PROMPT_STRICT =
  "この画像は3人の顔を機械的に平均して合成した画像です。あなたの仕事は、入力画像に写っている人物そのものを、自然な1枚の肖像写真に仕上げることです。厳守事項: 目・鼻・口・眉の形、顔の骨格と輪郭、肌の色合い、視線・向き・表情は入力画像から一切変更しないこと。別の顔を作ったり、元の3人のいずれかに寄せたりしないこと。補完してよいのは、顔の外側の髪・首・衣服・背景・照明、および合成由来のごく軽微な歪みの自然化のみ。出力は縦長の自然なポートレート1枚。";

const PROMPT_REFS =
  "画像1は3人の顔を平均して合成した画像です。画像2〜4はその元になった3人の写真です。画像1に写っている「3人の平均の人物」を特定し、その顔の骨格・目鼻口・輪郭・肌の色合い・向き・表情を維持したまま、自然な肖像写真1枚に仕上げてください。元の3人のいずれかに寄せず、髪・背景・照明だけを自然に補完してください。";

async function callGemini(images: { mime: string; b64: string }[], prompt: string, model: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.b64 } }))
          ]
        }]
      })
    }
  );
  const data: any = await res.json();
  if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${data?.error?.message || ""}`);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p: any) => p.inlineData || p.inline_data);
  const inline = img && (img.inlineData || img.inline_data);
  if (!inline?.data) throw new Error(`${model}: no image: ${JSON.stringify(data).slice(0, 300)}`);
  return { b64: inline.data, mime: inline.mimeType || inline.mime_type || "image/jpeg" };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle", timeout: 15000 });
  await page.click("#load-samples-btn");
  await page.waitForFunction(() => !document.getElementById("mix-button")!.hasAttribute("disabled"), { timeout: 15000 });
  await page.click("#mix-button");
  await page.waitForSelector("#result-section:not([hidden])", { timeout: 60000 });

  // 合成結果（生）と2倍拡大版、元写真3枚
  const { blend, blend2x } = await page.evaluate(() => {
    const c = document.getElementById("result-canvas") as HTMLCanvasElement;
    const o = document.createElement("canvas");
    o.width = c.width * 2; o.height = c.height * 2;
    const x = o.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, o.width, o.height);
    x.drawImage(c, 0, 0, o.width, o.height);
    return {
      blend: c.toDataURL("image/png").split(",")[1],
      blend2x: o.toDataURL("image/png").split(",")[1]
    };
  });
  await browser.close();

  const refImgs = ["samples/face1_lincoln.jpg", "samples/face2_einstein.jpg", "samples/face3_curie.jpg"]
    .map(p => ({ mime: "image/jpeg", b64: readFileSync(p).toString("base64") }));

  writeFileSync(`${OUT}/0-blend.png`, Buffer.from(blend, "base64"));

  const variants: { name: string; model: string; prompt: string; images: { mime: string; b64: string }[] }[] = [
    { name: "A-現行プロンプト", model: "gemini-3.1-flash-image", prompt: PROMPT_BASE, images: [{ mime: "image/png", b64: blend }] },
    { name: "B-同一性ロック", model: "gemini-3.1-flash-image", prompt: PROMPT_STRICT, images: [{ mime: "image/png", b64: blend }] },
    { name: "C-ロック+2倍解像度", model: "gemini-3.1-flash-image", prompt: PROMPT_STRICT, images: [{ mime: "image/png", b64: blend2x }] },
    { name: "D-元写真3枚を参照", model: "gemini-3.1-flash-image", prompt: PROMPT_REFS, images: [{ mime: "image/png", b64: blend }, ...refImgs] },
    { name: "E-ロック+Proモデル", model: "gemini-3-pro-image", prompt: PROMPT_STRICT, images: [{ mime: "image/png", b64: blend }] }
  ];

  for (const v of variants) {
    const t = Date.now();
    try {
      const r = await callGemini(v.images, v.prompt, v.model);
      writeFileSync(`${OUT}/${v.name}.jpg`, Buffer.from(r.b64, "base64"));
      console.log(`OK  ${v.name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    } catch (e: any) {
      console.log(`ERR ${v.name}: ${e.message}`);
    }
  }

  // 比較ページ（agy が目視するために）
  const files = [
    ["0-blend.png", "合成元（比較の基準）"],
    ["A-現行プロンプト.jpg", "A: 現行プロンプト"],
    ["B-同一性ロック.jpg", "B: 同一性ロック・プロンプト強化"],
    ["C-ロック+2倍解像度.jpg", "C: B + 入力2倍解像度"],
    ["D-元写真3枚を参照.jpg", "D: 元写真3枚を参照に追加"],
    ["E-ロック+Proモデル.jpg", "E: B + gemini-3-pro-image"]
  ];
  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>AI仕上げ A/B</title>
<style>body{font-family:sans-serif;background:#111;color:#eee;margin:20px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}figcaption{padding:6px;background:#333;font-size:14px}img{width:100%;background:#fff}</style></head>
<body><h1>AI仕上げバリエーション</h1><div class="g">
${files.map(([f, l]) => `<figure><figcaption>${l}</figcaption><img src="${f}"></figure>`).join("\n")}
</div></body></html>`;
  writeFileSync(`${OUT}/index.html`, html);
  console.log("比較ページ: http://127.0.0.1:8099/scratch/ab/");
}

main().catch(e => { console.error(e); process.exit(1); });
