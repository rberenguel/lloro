// Content script for page extraction using Readability
// This script is injected into web pages to extract readable content

(function () {
  // Check if already injected
  if (window.__geminiExtractorLoaded) return;
  window.__geminiExtractorLoaded = true;

  // Listen for extraction requests
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractContent") {
      try {
        const content = extractContent();
        sendResponse({ success: true, content });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
    return true; // Keep channel open for async response
  });

  function extractContent() {
    // Try to use Readability if available
    if (typeof Readability !== "undefined") {
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (article) {
        return {
          title: article.title,
          content: article.textContent,
          excerpt: article.excerpt,
          byline: article.byline,
          siteName: article.siteName,
        };
      }
    }

    // Fallback: manual extraction
    return extractManually();
  }

  function extractManually() {
    const title = document.title;

    // Try common article containers
    const selectors = [
      "article",
      '[role="main"]',
      "main",
      ".post-content",
      ".article-content",
      ".entry-content",
      "#content",
      ".content",
    ];

    let contentElement = null;
    for (const selector of selectors) {
      contentElement = document.querySelector(selector);
      if (contentElement) break;
    }

    if (!contentElement) {
      contentElement = document.body;
    }

    // Clone and clean
    const clone = contentElement.cloneNode(true);

    // Remove unwanted elements
    const removeSelectors = [
      "script",
      "style",
      "noscript",
      "iframe",
      "nav",
      "header",
      "footer",
      "aside",
      ".sidebar",
      ".navigation",
      ".menu",
      ".ads",
      ".social-share",
      ".comments",
      ".related-posts",
    ];

    removeSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((el) => el.remove());
    });

    // Get text content
    let text = clone.innerText || clone.textContent;

    // Clean up whitespace
    text = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n\n");

    return {
      title,
      content: text,
      excerpt: text.substring(0, 500),
      byline: null,
      siteName: window.location.hostname,
    };
  }
})();
