# Queue Cleaner

The Queue Cleaner watches the queue of every connected *arr instance and
removes downloads that are stuck, step by step and only for a good reason.

## Before you arm it

The Queue Cleaner starts in **dry run** for every new instance. It records
what it would do but changes nothing in your services.

1. Let it run for a while and check the **Preview** and **History** tabs.
2. Switch off other queue cleaners for the same instance, so two tools do
   not act on the same download.
3. Click **Arm** and confirm.

You can go back to dry run at any time.

## Rules

The first matching rule decides:

| Rule                                                                                        | What happens                                                                                                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Protected (tag or whitelist)                                                                | Never touched                                                                                                          |
| Infrastructure problem (disk full, missing path, permissions, root folder, download client) | The cleaner pauses for this instance and raises an issue. No strikes. It continues by itself once the problem is gone. |
| Episode title not known yet (TBA)                                                           | Waits without strikes, at most one week                                                                                |
| Blocked import with a clean import preview                                                  | Waits for **Review import** without strikes, at most one week. Wardarr never imports on its own.                       |
| Other blocked imports, failed and stalled downloads                                         | Collect strikes                                                                                                        |
| Slow downloads                                                                              | Collect strikes only when switched on                                                                                  |

A blocked import is a finished download the app does not import on its own:
"Import blocked" in Sonarr and Radarr, "Import failed" in Lidarr and Readarr
(for example when the album match is not close enough or tracks are
missing), and "Waiting to import" with a warning in older versions. The row
shows the app's reason.

A new strike comes at the earliest after the strike interval. Strikes reset
when the problem disappears.

After the last strike:

- a title already in the library is only removed, without blocklist or search;
- otherwise the download is removed, the release blocklisted and the title
  searched again, which counts as one attempt;
- after the last attempt there are no more searches, an issue appears and
  Hunting skips the title.

## Defaults

| Setting                         | Default              |
| ------------------------------- | -------------------- |
| Strikes before removal          | 4                    |
| Time between strikes            | 60 min               |
| Check every                     | 5 min                |
| Wait for unknown episode titles | 1 week               |
| Wait for "Review import"        | on, at most 1 week   |
| Attempts per title              | 3                    |
| Stalled after                   | 6 h without progress |
| Failed downloads                | on                   |
| Slow downloads                  | off                  |
| Removals per run                | at most 20           |
| Dry run                         | on after connecting  |

## Orphaned downloads

Downloads in a download client that no connected *arr instance knows are
listed under **Orphaned** and as an issue. Wardarr deletes them only after
you confirm.
