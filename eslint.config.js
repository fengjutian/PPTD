import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src-tauri/target", "src-tauri/gen"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Several sanitizers intentionally match control characters.
      "no-control-regex": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/core/document-model/__fixtures__/**"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // CommonJS helper scripts at the repository root are Node programs, not
    // browser code. Without the Node globals they report every `require` and
    // `console` as an undefined name.
    files: ["**/*.cjs"],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // A CommonJS script may shadow a Node global with its own binding.
      "no-redeclare": ["error", { builtinGlobals: false }],
    },
  },
  {
    // ES module helper scripts are Node programs too.
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },
  {
    files: ["src-tauri/**"],
    languageOptions: { globals: globals.node },
  },
);
