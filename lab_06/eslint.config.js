import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist", "**/logs", "**/node_modules", "client/vite.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error", // `unknown` instead: look first, then use
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["client/src/**/*.ts"], languageOptions: { globals: globals.browser } },
  {
    files: ["server/**/*.{ts,mjs}", "client/{test,scripts}/**/*.{ts,mjs}", "shared/{test,scripts}/**/*.{ts,mjs}", "scripts/**/*.mjs", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/test/**/*.ts", "**/scripts/**/*.mjs"],
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    // shared/src runs in the browser AND in Node: no DOM, no Node modules, no clock, no Math.random.
    files: ["shared/src/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", "window", "document", "performance", "process", "Buffer", "require", "setTimeout", "setInterval", "Date", "crypto"],
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "use the world's seeded rng" }],
      "no-restricted-imports": ["error", { patterns: ["node:*"] }],
    },
  },
];
