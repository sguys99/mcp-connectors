## Summary

<!-- What does this change do, and why? Link the related issue, for example "Closes #123". -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New MCP server
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Tooling, build, or dependencies
- [ ] Breaking change (describe the migration below)

## Checks

<!-- Check what you ran. Leave items that do not apply unchecked and say why. See CONTRIBUTING.md. -->

**Python**

- [ ] `uv run ruff check src/ scripts/ tests/`
- [ ] `uv run ruff format --check src/ scripts/ tests/`
- [ ] `make test`
- [ ] `make test-scenarios` (NL2SQL changes)
- [ ] `make test-integration` and `make test-scenarios-real` (NL2SQL database code changes)

**Frontend**

- [ ] `cd frontend && npm run lint`
- [ ] `cd frontend && npx tsc --noEmit`
- [ ] `cd frontend && npm run test`
- [ ] `cd frontend && npm run build`
- [ ] `make test-e2e` (Playwright)

**Secrets**

- [ ] `uv run pre-commit run --all-files` passes (includes gitleaks)
- [ ] No real credentials, hostnames, or personal data in code, fixtures, docs, or screenshots

## Conventions

- [ ] LLM-visible strings (tool, parameter, resource, prompt descriptions and error messages) are in English, and errors end with a `[CODE]` suffix
- [ ] New registry entries have both `description` and `description_ko`
- [ ] No `__init__.py` added under `tests/`, and `_common/` does not import from a server
- [ ] `.env.example`, the server README, and `CHANGELOG.md` (Unreleased) are updated when behavior or configuration changed

## Documentation

- [ ] Docs follow the writing rules: no em dash, no middle dot, and a 2:8 polite casual to formal ratio in Korean documents
- [ ] `README.md` and `README.ko.md` stay in sync if either changed

## Screenshots

<!-- Required for UI changes: light and dark mode, and a mobile width if layout changed. Remove this section otherwise. -->

| Light | Dark |
|---|---|
|  |  |

## Notes for reviewers

<!-- Anything that needs special attention, follow-up work, or known limitations. -->
