const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const analytics = readFileSync(path.join(root, "ga4.js"), "utf8");
const readme = readFileSync(path.join(root, "README.md"), "utf8");

test("uses the approved identity-first title and social metadata", () => {
  const title = "Ada — AI Persona &amp; Assistant of EVH Consult";
  assert.match(html, new RegExp(`<title>${title}</title>`));
  assert.match(html, new RegExp(`property="og:title" content="${title}"`));
  assert.match(html, new RegExp(`name="twitter:title" content="${title}"`));
});

test("sets the approved Ada content group only inside the consent-gated loader", () => {
  assert.match(analytics, /'ada\.evhconsult\.eu': 'Ada'/);
  assert.match(analytics, /content_group: getContentGroup\(\)/);
  assert.ok(analytics.indexOf("if (loaded || !isApprovedHost() || !hasAnalyticsConsent()) return") < analytics.indexOf("content_group: getContentGroup()"));
});

test("uses the approved ecosystem terminology", () => {
  assert.match(readme, /EVH Consult ecosystem/);
  assert.doesNotMatch(readme, /EVH Consult web ecosystem|EVH ecosystem/);
});
