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
    // Pristine upstream snapshot of https://github.com/Shivam-s07/simulator at
    // 1a1eb78. It is a reference to port FROM and diff against, never built or
    // shipped by this app — it is a Vite project with its own toolchain, its
    // own eslint config and dependencies we do not install. Linting it reported
    // 199 errors and 1,770 warnings against code we must not edit.
    "vendor/**",
  ]),
  {
    /**
     * The native port of that vendored simulator.
     *
     * We DO ship this, so it is linted rather than ignored — but it is 12k
     * lines of someone else's code, kept deliberately close to upstream so
     * `diff vendor/simulator/src components/static-simulator` stays readable
     * and re-syncing is possible. Rewriting it to satisfy rules our own code
     * follows would destroy that property for no behavioural gain.
     *
     * Only the rules that fire in bulk on their style are relaxed, and only
     * here. Correctness rules (react-hooks/rules-of-hooks, no-undef,
     * no-unused-vars) still apply.
     */
    files: ["components/static-simulator/**/*.{ts,tsx}"],
    rules: {
      // ~38 `any`s in their component/pin property bags.
      "@typescript-eslint/no-explicit-any": "off",
      // ~83 hits, all Date.now()/Math.random()/mutation-during-render in the
      // React Compiler's new purity checks. Fixing them means restructuring
      // their render path.
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "off",
      "prefer-const": "off",
      "react/no-unescaped-entities": "off",
      // Upstream marks a deliberately-unused binding by prefixing it with an
      // underscore; honour their convention rather than renaming their props.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
