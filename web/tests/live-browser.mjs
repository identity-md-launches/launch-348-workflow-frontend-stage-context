import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// A bounded foreground preview; unlike browser.mjs, RPC requests are real reads.
const root = new URL("../../", import.meta.url);
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (!path.startsWith("/preview/") || path.includes("..")) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const file = path.slice(9) || "index.html";
    res.setHeader(
      "Content-Type",
      file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "application/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".svg")
              ? "image/svg+xml"
              : "application/json",
    );
    res.end(readFileSync(new URL("dist/" + file, root)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const report = {
  date: new Date().toISOString(),
  mode: "Real public RPC browser reads; no wallet injected, no signing",
  consoleErrors: [],
  failedRequests: [],
};
page.on("pageerror", (error) => report.consoleErrors.push(error.message));
page.on("requestfailed", (request) =>
  report.failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText,
  }),
);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page
    .getByText("● Live reads", { exact: true })
    .waitFor({ timeout: 55000 });
  report.result = "PASS";
} catch (error) {
  report.result = "UNAVAILABLE";
  report.error = error.message;
}
report.visibleState = await page.locator("body").innerText();
await page.screenshot({
  path: new URL("docs/frontend/live-desktop.png", root).pathname,
  fullPage: true,
});
writeFileSync(
  new URL("docs/frontend/live-browser.json", root),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      result: report.result,
      consoleErrors: report.consoleErrors,
      failedRequests: report.failedRequests,
    },
    null,
    2,
  ),
);
await browser.close();
await new Promise((resolve) => server.close(resolve));
