# Testbed

A local setup with invented data for trying Wardarr and for development.
Never connect it to real instances or real media.

```sh
docker compose -f testbed/compose.yaml up -d --build
node testbed/seed.mjs
```

This starts Wardarr and a set of mock services (`apps/e2e/mocks/services.mjs`)
that reproduce the Issue Center example: an indexer that fails in Sonarr,
Radarr and Radarr 4K, an update for Lidarr and three failed downloads.
The mocks can be changed at runtime:

```sh
curl -X POST 'http://127.0.0.1:19000/__control/fix?what=indexer'
curl -X POST 'http://127.0.0.1:19000/__control/reset'
```

## Real services

The `real` profile adds public images of Sonarr (twice), Radarr, Prowlarr,
qBittorrent and Jellyfin. The *arr apps start with an invented API key
(`00000000000000000000000000000001`) from `testbed/config/`.

```sh
docker compose -f testbed/compose.yaml --profile real up -d
node testbed/seed.mjs --real
```

qBittorrent prints a temporary password to its log on first start, and
Jellyfin needs its setup wizard once; add both in Wardarr's settings by hand.

Remove everything, including the volumes:

```sh
docker compose -f testbed/compose.yaml --profile real down -v
```
