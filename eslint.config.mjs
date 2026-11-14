export default [
  {
    ignores: [
      "node_modules/**",
      "index.html",
      "Onnet-*.html",
      "artifacts/**"
    ]
  },
  {
    files: ["src/**/*.js", "scripts/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script"
    },
    rules: {
      "no-cond-assign": "error",
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-dupe-keys": "error",
      "no-fallthrough": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-obj-calls": "error",
      "no-prototype-builtins": "error",
      "no-self-assign": "error",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "curly": ["warn", "multi-line"],
      "eqeqeq": ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": "warn"
    }
  },
  {
    files: ["src/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-cond-assign": "error",
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-dupe-keys": "error",
      "no-fallthrough": "error",
      "no-invalid-regexp": "error",
      "no-irregular-whitespace": "error",
      "no-obj-calls": "error",
      "no-prototype-builtins": "error",
      "no-self-assign": "error",
      "no-sparse-arrays": "error",
      "no-unexpected-multiline": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "curly": ["warn", "multi-line"],
      "eqeqeq": ["warn", "smart"],
      "no-var": "warn",
      "prefer-const": "warn"
    }
  }
];
