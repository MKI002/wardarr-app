# 0006: Releases and deployment

Status: accepted

## One image, two architectures

Wardarr ships as one container image for `linux/amd64` and `linux/arm64` on
the GitHub Container Registry. Every push to `main` publishes the `main` tag
and a short commit tag; releases add `X.Y.Z`, `X.Y` and `latest`. The image
runs as user `1000:1000`, needs no capabilities and works with a read-only
root file system, which CI checks in its smoke test.

## Releases from a button

A release is started by hand with the **Release** workflow and a version
number. It waits for green CI on that commit, creates the tag and the GitHub
release with generated notes (grouped by pull request label, see
`.github/release.yml`) and then starts CI on the tag, which publishes the
image. CI is started explicitly because a tag created with the workflow token
does not trigger other workflows.

No version is stored in `package.json` files; the tag is the version.

## Deployment examples

`deploy/docker-compose.yml` shows every option with safe defaults and
optional hardening. `deploy/unraid/wardarr.xml` is a Community Applications
style template; it runs Wardarr as `99:100`, the usual owner of Unraid
appdata, so no `chown` is needed.
