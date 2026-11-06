# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through
[GitHub's private vulnerability reporting](https://github.com/MKI002/wardarr-app/security/advisories/new).

Include what you found, how to reproduce it and which version you tested. Use
invented data in your report; never send real keys, addresses or library
data. You get an answer as soon as possible, and a fix is released before the
details are published. Reporters are credited in the advisory unless they
prefer not to be.

## Supported versions

Security fixes go into the latest release. Please update before reporting.

## Scope

In scope: the Wardarr server, the web interface, the container image and the
release workflow.

Out of scope: vulnerabilities in the services Wardarr connects to (please
report those to their projects), attacks that need an admin account, which can
already add services by design, and missing hardening on setups that expose
Wardarr to the internet without HTTPS.

## How Wardarr protects your setup

- Every endpoint requires a session, except login, first setup and `/healthz`.
  Endpoints are admin-only unless they say otherwise.
- Passwords are hashed with Argon2id. Credentials for services and
  notification channels are encrypted with AES-256-GCM and never returned to
  the browser.
- Sessions use `HttpOnly`, `SameSite=Lax` cookies with CSRF tokens on every
  changing request.
  Strict security headers and a content security policy are set on every
  response.
- Only admins add services and notification channels. Addresses must be
  `http` or `https`; cloud metadata and link-local addresses are blocked,
  local networks are allowed. Credentials are never sent along on redirects.
- Logs mask API keys, tokens, credentials in URLs and user names.
- The container runs as an unprivileged user, and dependencies are audited in
  CI. There is no telemetry.
