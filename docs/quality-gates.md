# OnNet — Quality and release gates

This document defines the evidence required before changes are considered safe to merge or release.

## Application scope and business invariants

OnNet is a static web application hosted on GitHub Pages. Salary calculations are delegated to the official Mon-entreprise / Urssaf API. The browser stores comparison scenarios locally; sharing by URL encodes selected data in the URL fragment.

The following rules are product invariants:

- Never silently convert a 39-hour salary to a 35-hour equivalent.
- Keep gross and net amounts distinct.
- Do not reintroduce income-tax or withholding-tax calculations.
- Do not send salary data to the Urssaf API before explicit user consent.
- Revoking consent must not delete saved comparison scenarios.
- Updates must not reset or overwrite saved scenarios.
- SMIC and INSEE median are reference data, not substitutes for an individual Urssaf calculation.
- A 39-hour scenario currently relies on the documented assumption of 4 overtime hours paid with a 25% premium; this is not a universal collective-agreement calculation.

## Two complementary workflows

### 1. Functional quality — `.github/workflows/quality.yml`

This is the primary quality pipeline. It already runs:
- JavaScript syntax checks.
- ESLint and Stylelint.
- Unit and integration tests covering persistence, session state, API client and calculation adapters.
- Build verification.
- Playwright/Chromium browser journeys.
- Generation of the standalone HTML artifacts in the read-only test job.
- Browser test and visual artifact publication.
- Synchronization of tested HTML artifacts in a separate, write-enabled job for eligible same-repository pull requests. The write-enabled job does not execute repository scripts or tests.

Do not duplicate these jobs in the Security Guardian workflow. Keep this pipeline as the required functional gate.

### 2. Security — `.github/workflows/quality-guardian.yml`

The Security Guardian runs on pull requests to `main`, pushes to `main`, manual dispatch, and every Tuesday at 03:17 UTC.

It deliberately focuses on checks that the functional pipeline does not provide:
- `npm audit --package-lock-only --audit-level=high` against the committed lockfile.
- CodeQL JavaScript/TypeScript analysis using the `security-extended` query suite.

It does not rebuild the application or repeat the browser/unit suite. This separation reduces duplicate CI execution while keeping the security checks independently visible.

## Merge and release criteria

Do not merge a change when:
- The `Vérifications / test` job fails or has not completed.
- `npm dependency audit` or `CodeQL security analysis` fails or has not completed.
- A P0/P1 defect remains unresolved.
- A changed user journey has not been exercised by an appropriate browser test.
- A calculation change lacks a documented reference case and expected result.
- A persistence change has not tested reload and legacy-state behavior.

A successful build alone is never sufficient evidence.

After validation, inspect the actual GitHub Pages deployment for changes that affect the published site. A PR check is not a production smoke test.

## Branch protection / ruleset

To make the gates mandatory, configure protection for `main` and require these exact checks after they have appeared in GitHub:

- `test` (from the `Vérifications` workflow).
- `Synchroniser les HTML validés` (required for same-repository PRs; skipped for forks because they have no write permission).
- `npm dependency audit`.
- `CodeQL security analysis`.

Also enable:
- Require a pull request before merging.
- Require conversation resolution.
- Block force pushes to `main`.
- Require branches to be up to date before merging only if this does not create excessive merge friction.

The repository rulesets listing currently returned no rulesets. The branch-protection endpoint could not be read with the active GitHub integration (403), so the presence or absence of classic branch protection has not been verified. Confirm the settings in GitHub's repository settings before claiming that merges are blocked on failed checks.

## Security boundaries

- `npm audit` checks known advisories in the lockfile; it is not a complete security audit.
- CodeQL is static analysis; it does not prove the absence of vulnerabilities.
- GitHub Pages does not provide application-server controls or server-side secret storage.
- Browser local storage and URL fragments are not encrypted. Do not place credentials or sensitive personal data in them.
- Mocked browser tests do not validate real Urssaf amounts. External API availability and calculation accuracy require separate, controlled checks.

## Required evidence for each finding

| Field | Required content |
| --- | --- |
| ID | Stable identifier |
| Severity | P0 / P1 / P2 / P3 |
| Status | Verified / Failed / Partial / Not tested / Not verifiable |
| Evidence | Exact test, output, file/line, or reproduction |
| Impact | User or security consequence |
| Fix | Minimal proposed correction |
| Regression test | Test added or reason it is not automatable |

Never report an unexecuted test as passed. Distinguish source inspection, mocked tests, real API checks, and production browser checks.
