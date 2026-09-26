import { chromium } from "playwright";

async function verify() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", (res) => { if (res.status() >= 400) networkErrors.push(`[${res.status()}] ${res.url()}`); });

  try {
    await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle", timeout: 15000 });
    await page.screenshot({ path: "scratch/01-initial.png", fullPage: true });

    // サンプル3枚をセット
    await page.click("#load-samples-btn");
    await page.waitForFunction(
      () => !document.getElementById("mix-button")!.hasAttribute("disabled"),
      { timeout: 15000 }
    );
    await page.screenshot({ path: "scratch/02-samples-loaded.png", fullPage: true });

    // 合成実行（MediaPipe読み込み+処理を待つ）
    await page.click("#mix-button");
    await page.waitForSelector("#result-section:not([hidden])", { timeout: 60000 });
    await page.screenshot({ path: "scratch/03-result.png", fullPage: true });

    // 結果キャンバスをPNGとして保存（目視検証用）
    const dataUrl = await page.evaluate(() =>
      (document.getElementById("result-canvas") as HTMLCanvasElement).toDataURL("image/png")
    );
    const b64 = dataUrl.split(",")[1];
    await Bun.write("scratch/result-canvas.png", Buffer.from(b64, "base64"));

    // 結果キャンバスの透明でないピクセル数
    const stats = await page.evaluate(() => {
      const c = document.getElementById("result-canvas") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let visible = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) visible++;
      return { w: c.width, h: c.height, visiblePixels: visible };
    });
    console.log(JSON.stringify({ stats, consoleErrors, pageErrors, networkErrors }, null, 2));
  } catch (error) {
    console.error("VERIFY FAILED:", error);
    await page.screenshot({ path: "scratch/99-failure.png", fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
}

verify();
