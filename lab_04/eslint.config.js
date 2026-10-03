import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/dist", "**/logs", "**/node_modules"] },
  js.configs.recommended,
  { files: ["client/src/**/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: [
      "server/**/*.{js,mjs}",
      "client/{test,scripts}/**/*.{js,mjs}",
      "client/*.config.js",
      "*.config.js",
    ],
    languageOptions: { globals: { ...globals.node, CustomEvent: "readonly" } },
  },
  {
    // The simulation must stay free of DOM / canvas access.
    files: ["client/src/sim/**/*.js"],
    rules: { "no-restricted-globals": ["error", "window", "document", "performance"] },
  },
];
