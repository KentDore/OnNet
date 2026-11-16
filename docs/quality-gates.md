# OnNet — Quality gates

This document defines the minimum evidence required before changes are considered safe.

## Scope

OnNet is a static web application hosted on GitHub Pages. Salary calculations are delegated to the official Mon-entreprise / Urssaf API. The browser stores comparison scenarios locally; sharing by URL encodes selected data in the URL fragment.

Business invariants that tests must protect:

- Never silently convert a 39-hour salary to a 35-hour equivalent.
- Keep gross and net amounts distinct.
- Do not reintroduce income-tax or withholding-tax calculations.
- Do not send salary data to the Urssaf API before explicit user consent.
- Revoking consent must not delete saved comparison scenarios.
- Updates must not reset or overwrite saved scenarios.
- The SMIC and INSEE median are reference data, not substitutes for an individual Urssaf calculation.
- A 39-hour scenario currently relies on the documented default assumption of 4 overtime hours paid with a 25% premium; it is not a universal collective-agreement calculation.

## Automated gates

The `OnNet Quality Guardian` workflow runs on pull requests to `main`, pushes to `main`, manual dispatch, and every Tuesday at 03:17 UTC.

It performs:

1. Locked dependency installation with `npm ci`.
2. JavaScript and CSS linting.
3. Existing unit and integration suites through `npm run test:all`.
4. Generated-build checks through `node --test test/build.test.js`.
5. Dependency vulnerability checks through `npm audit --audit-level=high`.
6. CodeQL JavaScript/TypeScript analysis with the security-extended query suite.

The repository's existing browser workflow remains responsible for Playwright/Chromium UI journeys. Its success must also be checked; the Quality Guardian workflow does not replace those browser tests.

## Release decision

A change is not release-ready if:

- Any required automated workflow fails, is cancelled, or has not completed.
- A P0/P1 defect remains unresolved.
- A changed user journey has not been exercised by an appropriate browser test.
- A calculation change lacks a documented reference case and expected result.
- A persistence change has not tested reload and migration/legacy-state behavior.
- A deployment has not been checked on the actual GitHub Pages URL.

A successful build alone is never sufficient evidence.

## Required GitHub repository setting

The workflow can report failures, but it cannot prevent merging by itself. To enforce the gate, configure a branch protection rule or repository ruleset for `main` and require these checks:

- `Quality gates (lint, tests, build, dependencies)`
- `CodeQL security analysis`
- The existing browser/UI verification check (select its exact check name from GitHub after a successful run).

Do not guess the browser check name. Select the check name shown by GitHub Actions.

Also enable:
- Require branches to be up to date before merging, if the project's merge cadence allows it.
- Require conversation resolution.
- Block force pushes to `main`.

These settings must be verified in GitHub repository settings; workflow YAML alone does not enforce them.

## Security boundaries

- `npm audit` checks known advisories in the dependency tree; it is not a complete security audit.
- CodeQL is static analysis; it does not prove the absence of vulnerabilities.
- GitHub Pages does not provide application-server controls or server-side secret storage.
- Browser local storage and URL fragments are not encrypted. Do not place credentials or sensitive personal data in them.
- External API availability and correctness require separate runtime checks; mocked browser tests do not validate real Urssaf amounts.

## Audit evidence format

For each finding, record:

| Field | Required content |
| --- | --- |
| ID | Stable identifier |
| Severity | P0 / P1 / P2 / P3 |
| Status | Verified / Failed / Partial / Not tested / Not verifiable |
| Evidence | Exact test, output, file/line, or reproduction |
| Impact | User or security consequence |
| Fix | Minimal proposed correction |
| Regression test | Test added or reason it is not automatable |

Never report an unexecuted test as passed. Separate source inspection, mocked tests, real API checks, and production browser checks.
