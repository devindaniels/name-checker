import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

async function openPage() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    const targetUrl =
      "https://www.mca.gov.in/content/mca/global/en/mca/fo-llp-services/company-llp-name-search.html";
    let initialHtml = null;

    // Handle requests
    page.on("request", (request) => {
      const url = request.url();

      if (url === targetUrl) {
        request.continue({
          headers: {
            ...request.headers(),
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            Pragma: "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
          },
        });
        return;
      }

      if (url.includes("/home")) {
        request.abort();
        return;
      }

      request.continue();
    });

    // Capture the initial HTML response
    page.on("response", async (response) => {
      if (response.url() === targetUrl) {
        try {
          initialHtml = await response.text();
        } catch (e) {
          console.error("Error capturing response:", e);
        }
      }
    });

    // Anti-bot measures
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Navigate and get content
    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const html = initialHtml || (await page.content());

      // Verify key elements
      const hasSearchBox = html.includes("masterdata-search-box");
      const hasSearchButton = html.includes("searchicon");
      const hasCaptchaDiv = html.includes("captchaModal");

      console.log("Page verification:", {
        hasSearchBox,
        hasSearchButton,
        hasCaptchaDiv,
        htmlLength: html.length,
        currentUrl: page.url(),
      });

      if (!hasSearchBox || !hasSearchButton) {
        throw new Error("Missing critical page elements");
      }

      return html;
    } catch (error) {
      console.error("Navigation error:", error);
      if (initialHtml) {
        return initialHtml;
      }
      throw error;
    }
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Test run
openPage()
  .then(() => console.log("Successfully retrieved search page"))
  .catch(console.error);
