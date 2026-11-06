# Privacy guard

Wardarr is a public project. The repository must never contain secrets or
personal data: names, e-mail addresses, IP addresses, host names, local paths,
API keys, user names or real library and release data. This applies to code,
commit messages, pull requests, screenshots, logs and test data.

Three guards run as git hooks (installed by `pnpm install` through lefthook)
and in CI.

| Guard          | Hook                             | What it checks                                                              |
| -------------- | -------------------------------- | --------------------------------------------------------------------------- |
| gitleaks       | pre-commit, pre-push, CI         | Secrets in the staged diff, unpushed commits and the full history           |
| Denylist       | pre-commit, commit-msg, pre-push | Your own list of forbidden terms (see below)                                |
| Artifact check | pre-commit, pre-push, CI         | Image metadata, source maps, lockfiles, home paths, e-mail and IP addresses |

## Installing the tools

- **gitleaks** v8.30.1: install a release binary, or `go install github.com/zricethezav/gitleaks/v8@v8.30.1`.
  Without a local binary the hook falls back to the official container image if Docker is running.
  If neither is available, the hook fails on purpose.
- **exiftool**: needed when images are committed (`apt install libimage-exiftool-perl`, `brew install exiftool`).

## Local denylist

The denylist holds terms that identify you or your setup, for example your
real name, your host names or the names of your libraries. It lives **outside**
the repository and is never committed or printed.

1. Create a file anywhere outside the repository, for example in your home directory.
2. Put one term per line. Matching is case-insensitive. Lines starting with `#`
   are comments, lines starting with `re:` are regular expressions.
3. Point the environment variable `WARDARR_DENYLIST` at the file, for example in your shell profile.

The hooks refuse a denylist that lives inside the repository. A hit reports
only the file and line, never the matching term. Set
`WARDARR_DENYLIST_REQUIRED=1` to make a missing denylist an error instead of a
warning.

## Values that look personal but are not

- Use example domains for e-mail addresses (`example.com`, `*.test`, `*.invalid`).
- Use documentation IP ranges in examples (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`).
- When an address is part of the logic, for example an SSRF test for private
  ranges, mark the line with a `privacy-allow` comment. The marker only
  silences the e-mail and IP checks.
- Test fixtures use invented titles and low-entropy fake keys such as
  `00000000000000000000000000000001`.

## If something leaked

If you find personal data or a secret in a commit that is already pushed, do
not rewrite history quietly. Report it to the maintainers as described in
`SECURITY.md`, and rotate any exposed secret.
