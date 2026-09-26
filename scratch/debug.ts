import { chromium } from "playwright";

async function debug() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle", timeout: 15000 });
  await page.click("#load-samples-btn");
  await page.waitForFunction(() => !document.getElementById("mix-button")!.hasAttribute("disabled"), { timeout: 15000 });
  await page.click("#mix-button");

  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const state = await page.evaluate(() => ({
      status: document.getElementById("status-message")?.textContent,
      error: document.getElementById("error-message")?.textContent,
      errorHidden: document.getElementById("error-message")?.hidden,
      resultHidden: document.getElementById("result-section")?.hidden,
    }));
    console.log(`t=${(i + 1) * 5}s`, JSON.stringify(state));
    if (!state.resultHidden || !state.errorHidden) break;
  }
  await browser.close();
}
debug();
