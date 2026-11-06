# Example TRaSH Guides data

Invented data in the layout of the [TRaSH Guides](https://github.com/TRaSH-Guides/Guides)
JSON files (`metadata.json` and `docs/json/<product>/...`). Tests, the
end-to-end suite and the demo point `WARDARR_TRASH_DIR` at this folder, so they
never download the real guides. The names, scores and expressions are made up
and only look like the real ones. `cf/example-broken.json` is invalid on
purpose: the parser must skip it and keep the rest.
