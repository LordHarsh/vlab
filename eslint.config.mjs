import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party bundle used only as an input to the component-art harvest.
    "public/vendor/**",
    // Downloaded AVR/WASM toolchain (gitignored). Vendored third-party code we
    // neither wrote nor ship — linting it produced 8 errors and ~500 warnings
    // that drowned out real findings in our own source.
    ".cache/**",
  ]),
]);

export default eslintConfig;
