# 0003: Queue Cleaner, Hunting and API version detection

Status: accepted

## Queue Cleaner

- The decision logic is a pure function in `packages/core/src/cleaner`
  (`planCleanerRun`). It takes the queue, the import previews, the stored
  state and the settings, and returns a plan. The server only fetches data,
  executes the plan and stores the result, so every rule is unit tested
  without a service.
- Rules are evaluated in a fixed order and the first match wins: ignored or
  protected, infrastructure problem (pause), TBA, clean import preview,
  blocked import, failed, stalled, slow. A download that becomes healthy
  loses its strikes.
- Records that share a download id (season packs) are one download. It is
  removed with one call through its first queue record, so no second call
  runs into a 404.
- Attempts are counted per title key (`episode:<id>`, `movie:<id>`,
  `season:<series>:<season>` and so on). A dry run never uses up attempts and
  keeps the download at its maximum strikes, so the preview stays visible
  and the history notes the decision once.
- Arming is its own endpoint with an explicit confirmation. A settings save
  cannot arm the cleaner. "Remove now", "Review import" and deleting an
  orphaned job are deliberate actions and run even in dry run.
- Orphaned client jobs are only reported when every enabled *arr queue is
  known, so a temporarily missing queue never makes a job look orphaned.
  Seeding and completed jobs are skipped because the *arr apps forget
  downloads after import.
- Cleaner findings are issues on the `cleaner` channel. They resolve only
  after the cleaner ran again, not after a regular poll.

## Hunting

- Selection, scheduling, the API budget and the pause reasons are pure
  functions in `packages/core/src/hunting`.
- Every API call of Hunting counts against the hourly budget, including
  reading the wanted lists and the history.
- Titles never searched by Wardarr come first, newest release first. Then
  the titles searched longest ago. A title is searched again at the earliest
  after the configured number of days.
- Several missing episodes of one season become one season search.
- Results come from the *arr history (grabbed, imported, failed). A search
  without a grab after two hours counts as "nothing found".

## API version detection

- Each *arr adapter has a version profile: the API versions Wardarr speaks
  and the product majors it was tested with.
- Detection reads `GET /api` (offered API versions) where available and then
  `system/status` of the newest API version both sides speak. Products
  without `GET /api` are probed with the known versions.
- The detection is cached. It runs again when the reported product version
  changes or a known endpoint answers 404, so a product update needs no
  restart of Wardarr.
- A product newer than the tested majors, or one offering a newer API than
  Wardarr speaks, runs in compatibility mode with the newest shared API and
  shows a Wardarr info issue. Sonarr v5 adds API v5; Wardarr keeps API v3
  there as long as Sonarr offers it.
- Whisparr v2 and v3 use different API shapes. The profile picks the shape
  from the detected product version, so an upgrade switches it.
