import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.js", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    // The simulation must stay free of DOM / canvas access.
    files: ["src/sim/**/*.js"],
    languageOptions: { globals: {} },
    rules: { "no-restricted-globals": ["error", "window", "document", "performance"] },
  },
];
