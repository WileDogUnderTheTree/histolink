const { createRequire } = require("node:module");
const path = require("node:path");
const requireFromFrontend = createRequire(path.join(process.cwd(), "frontend", "package.json"));
const ot = requireFromFrontend("openapi-typescript");
console.log("keys", Object.keys(ot));
(async () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(process.cwd(), "contracts", "api-v1.openapi.json"), "utf8");
  const ast = await ot.default(src);
  const out = ot.astToString(ast);
  console.log("len", out.length);
  console.log(out.slice(0, 200));
})();
