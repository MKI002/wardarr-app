# Live demo

The demo at <https://mki002.github.io/wardarr-app/> is the real Wardarr web UI. Only the server
is missing: every answer the UI asks for was recorded from a real Wardarr server beforehand.
So the demo looks and behaves like a real install, in both themes and both languages.

## How it is built

1. `scripts/demo/services.mjs` runs invented services: two Sonarrs, two Radarrs, Lidarr,
   Prowlarr, qBittorrent, SABnzbd, Jellyfin and Seerr. They hold the demo's titles, queues,
   streams and requests.
2. `scripts/demo/capture.mjs` starts the built Wardarr server against these services, sets it
   up the way a person would (admin, users, instances, notifications), adds some play history
   and records every API answer the UI needs into `apps/web/src/demo/fixtures.json`. Host
   names in the recording are replaced with ones a real install would use, and ids are made
   stable so a new recording changes little.
3. `pnpm --filter @wardarr/web build:demo` builds the web UI with `--mode demo`. In this mode
   `src/demo/install.ts` answers API calls from the recording before the app starts. Only the
   demo build contains this code; the normal build and the container image do not.

The recorded timestamps move forward to the moment the demo is opened, so "3 minutes ago"
stays 3 minutes ago. Changes in the demo (muting an issue, approving a request, switching the
theme) work in memory and are gone after a reload.

The [Demo workflow](../.github/workflows/demo.yml) records the data again and publishes the
demo to GitHub Pages on every push to `main`, so the demo always matches the current code.
GitHub Pages must be set to deploy from GitHub Actions (Settings → Pages → Source).

Try it locally:

```sh
pnpm build
node scripts/demo/capture.mjs        # optional: record the data again
pnpm --filter @wardarr/web dev:demo  # or build:demo for a static build
```

When the API gains a new page or endpoint, add the GET requests it makes to the list in
`capture.mjs` and, if the demo should show data there, give the mock services something to
return.

## Titles

The films are real and in the public domain both in the United States and in the European
Union. In the US every film published before 1931 is in the public domain today. In the EU a
film is protected until 70 years after the death of the last of its principal director,
screenwriter, dialogue author and composer of music written for it.

| Film                    | Year | Last relevant author died        | Public domain in the EU since |
| ----------------------- | ---- | -------------------------------- | ----------------------------- |
| A Trip to the Moon      | 1902 | Georges Méliès, 1938             | 2009                          |
| The Great Train Robbery | 1903 | Edwin S. Porter, 1941            | 2012                          |
| Intolerance             | 1916 | D. W. Griffith, 1948             | 2019                          |
| Nanook of the North     | 1922 | Robert J. Flaherty, 1951         | 2022                          |
| Nosferatu               | 1922 | Henrik Galeen (screenplay), 1949 | 2020                          |

Films that were considered and left out: _Night of the Living Dead_ (1968) is in the public
domain in the US because it was published without a copyright notice, but that rule does not
apply in the EU. _Metropolis_ (1927) stays protected in the EU until 2047.

The posters in `apps/web/src/demo/posters/` were drawn for this project. Original posters are
not used, because many of them are still protected even where the film is not. The short
descriptions are written for this project as well.

Everything else is invented: the series (_Lanternfall_, _The Salt Archive_, _Kestrel
Station_), the users, the indexers, the albums, the host names, the API keys and all numbers.
