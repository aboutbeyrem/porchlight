// Writes docs/CHECKS.md from the check catalog. Run: node scripts/make-catalog.js
import fs from "node:fs";
import { catalogMarkdown } from "../src/catalog.js";

const text = `# Porchlight check catalog

Every finding has a stable ID, so it can be tracked in tickets, accepted in a policy file, or filtered in a CSV
export. Severity comes from the finding level (fix soon = high, worth fixing = medium, good to know = low, all good =
pass), and anything a device opened to the internet is raised to **critical**.

The CIS Controls v8 column lists the safeguards each check relates to. That mapping is Porchlight's own reading of
the safeguards, not a certification by the Center for Internet Security.

Regenerate this file with \`node scripts/make-catalog.js\`.

${catalogMarkdown()}
`;
fs.writeFileSync(new URL("../docs/CHECKS.md", import.meta.url), text);
console.log("docs/CHECKS.md written");
