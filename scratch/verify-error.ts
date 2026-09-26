import { chromium } from "playwright";

async function verifyError() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle", timeout: 15000 });
  await page.click("#load-error-sample-btn");
  await page.waitForFunction(() => !document.getElementById("mix-button")!.hasAttribute("disabled"), { timeout: 15000 });
  await page.click("#mix-button");
  // エラーまたは結果のどちらかが出るまで待つ（誤検出=結果が出たら失敗）
  await page.waitForFunction(
    () => !document.getElementById("error-message")!.hidden || !document.getElementById("result-section")!.hidden,
    { timeout: 60000 }
  );
  const out = await page.evaluate(() => ({
    error: document.getElementById("error-message")!.textContent,
    errorHidden: document.getElementById("error-message")!.hidden,
    resultHidden: document.getElementById("result-section")!.hidden,
  }));
  console.log(JSON.stringify(out));
  console.log(out.errorHidden === false && out.resultHidden === true ? "PASS: 顔なし画像はエラーになった" : "FAIL: 誤検出した");
  await browser.close();
}
verifyError();
