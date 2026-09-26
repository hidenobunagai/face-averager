import { chromium } from "playwright";

const KEY = process.env.GEMINI_KEY_FOR_TEST || "";
const BASE = "http://127.0.0.1:8099/";
const results: string[] = [];

async function blend(page: any) {
  await page.click("#load-samples-btn");
  await page.waitForFunction(() => !document.getElementById("mix-button")!.hasAttribute("disabled"), { timeout: 15000 });
  await page.click("#mix-button");
  await page.waitForSelector("#result-section:not([hidden])", { timeout: 60000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // --- Test 1: キーなし → エラー＋設定パネルが開く
  {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    await blend(page);
    const btnVisible = await page.isVisible("#ai-finish-button");
    if (!btnVisible) throw new Error("Test1: AIボタンが表示されていない");
    await page.click("#ai-finish-button");
    await page.waitForFunction(() => !document.getElementById("error-message")!.hidden, { timeout: 5000 });
    const err = await page.textContent("#error-message");
    const settingsOpen = await page.evaluate(() => (document.getElementById("ai-settings") as HTMLDetailsElement).open);
    if (!err!.includes("APIキーが必要")) throw new Error("Test1: エラー文言不一致: " + err);
    if (!settingsOpen) throw new Error("Test1: 設定パネルが開いていない");
    results.push("Test1 (no key): PASS — エラー表示＋設定パネル自動オープン");
    await page.close();
  }

  // --- Test 2: 実キーでAI仕上げ
  if (!KEY) {
    results.push("Test2 (real key): SKIPPED — GEMINI_KEY_FOR_TEST なし");
  } else {
    const ctx = await browser.newContext();
    await ctx.addInitScript((k) => {
      localStorage.setItem("facemix.gemini.key", k);
    }, KEY);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(BASE, { waitUntil: "networkidle", timeout: 15000 });
    await blend(page);
    await page.click("#ai-finish-button");
    await page.waitForSelector("#ai-result:not([hidden])", { timeout: 90000 });
    await page.waitForFunction(() => {
      const img = document.getElementById("ai-result-img") as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    }, { timeout: 30000 });
    const info = await page.evaluate(() => {
      const img = document.getElementById("ai-result-img") as HTMLImageElement;
      return { w: img.naturalWidth, h: img.naturalHeight, srcLen: img.src.length, mime: img.src.slice(5, img.src.indexOf(";")) };
    });
    if (!info.w || info.srcLen < 100000) throw new Error("Test2: 画像が不正 " + JSON.stringify(info));
    const b64 = (await page.evaluate(() => (document.getElementById("ai-result-img") as HTMLImageElement).src)).split(",")[1];
    await Bun.write("/tmp/ai-finish-e2e.jpg", Buffer.from(b64, "base64"));
    results.push(`Test2 (real key): PASS — ${info.w}x${info.h} ${info.mime} を取得`);
    await page.close();
  }

  await browser.close();
  console.log(results.join("\n"));
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
