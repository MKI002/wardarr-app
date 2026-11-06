# Wardarr

Wardarr is a self-hosted control center for the *arr stack, download clients,
media servers and Seerr. It shows status, issues, streams, downloads, requests
and statistics in one place and keeps the download queue clean.

Wardarr is under active development and not ready for use yet.

## Development

Requirements: Node.js 24, pnpm 10, gitleaks and exiftool (see [docs/privacy-guard.md](docs/privacy-guard.md)).

```sh
pnpm install
pnpm dev
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e`
(after `pnpm build`). A local setup with invented services lives in
[testbed/](testbed/README.md).

## License

MIT. Copyright The Wardarr Authors.
