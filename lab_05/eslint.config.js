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
    files: ["shared/{test,scripts}/**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    // shared/src runs in the browser AND in Node: no DOM, no Node modules, no clock, no Math.random.
    files: ["shared/src/**/*.js"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "performance",
        "process",
        "Buffer",
        "require",
        "setTimeout",
        "setInterval",
        "Date",
        "crypto",
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "use the world's seeded rng" },
      ],
      "no-restricted-imports": ["error", { patterns: ["node:*"] }],
    },
  },
];
