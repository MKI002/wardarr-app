# TRaSH Guides

The **TRaSH Guides** tab pushes quality profiles, custom formats, quality
sizes and naming from the [TRaSH Guides](https://trash-guides.info/) to Sonarr
(v4 and later) and Radarr, and keeps them in sync. Nothing changes in an
instance without a preview, unless you turn on auto sync for it.

## Templates

A template says what an instance gets:

- one or more **TRaSH quality profiles**, optionally under your own name in
  the instance,
- the **custom format groups** of each profile (recommended groups are
  preselected, required formats always come with a group),
- **own scores** that replace the guide score and stay when the guide changes,
- extra custom formats that are not in the profile,
- the **quality sizes** of the guide, or "leave as it is",
- **naming** schemes for folders and files, and whether renaming is on.

One template can serve several instances, for example two Radarrs with the
same setup. A template is for one product; Radarr and Sonarr have their own.
The editor shows each custom format with its guide score, where it comes from
(profile, group or added by you) and warnings, such as two formats that the
guide marks as conflicting.

**Read existing setup** on an instance creates a template from what the
instance already has: profiles whose names match TRaSH profiles and the groups
whose formats carry a score there.

## Preview and sync

**Preview and sync** lists every change per object and field, with the value
now, the value after the sync and why it changes:

| Why                     | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| Guide or template       | The TRaSH Guides or your template changed since the last sync |
| Changed in the instance | Someone changed the setting in Sonarr or Radarr               |
| First sync              | The instance was never synced by Wardarr                      |

On the first sync, custom formats and profiles that already exist with the
same name are taken over instead of being created twice. Custom formats that
the template no longer uses are only removed when you tick the box; Wardarr
only removes formats it created or took over.

Before every sync Wardarr backs up everything it is about to change. The
**History** tab lists every sync with its result, and **Roll back** restores
the backup: changed objects get their old values back and objects the sync
created are removed. After a rollback the guard of the instance switches to
notify, so it does not apply the change again.

## The guard

The guard checks each instance with a template every 6 hours, after every
guide update and when an instance's version changes.

| Mode             | What happens                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Off              | Nothing.                                                                                                               |
| Notify (default) | Differences appear as an issue in the Issue Center. Nothing changes.                                                   |
| Auto sync        | Changes of the guide and the template are applied, each with a backup. Changes made in the instance are only reported. |
| Strict           | Like auto sync, and changes made in the instance are set back too.                                                     |

Auto sync and strict need a confirmation and a first sync by hand. Even then
the guard stops and waits for you when a change is large:

- more than 25 changes at once (the limit is in the settings),
- a profile's cutoff or allowed qualities would change,
- something would be removed,
- in strict mode, the same setting was set back three times within a day,
  which usually means another tool such as Recyclarr manages it too.

Use only one tool per instance for these settings. If Recyclarr, Notifiarr or
Profilarr already sync an instance, keep the guard on notify or off there.

## Release test

The **Release test** tab sends a release name to the instance itself and
shows the quality it detects, the custom formats that match and the score the
release gets in each profile. That answers "why was this grabbed" or "why was
this rejected" without waiting for a real release.

## Where the guide comes from

Wardarr downloads the JSON files of the official repository on GitHub the
first time you open a template and then once a day while at least one
instance has a template. Only files that changed are downloaded again. The
**Guide changes** list shows what changed between versions.

The repository and branch can be changed in the settings, for example to a
fork. Installations without internet access set `WARDARR_TRASH_DIR` to a
local checkout of the guides; the folder needs `metadata.json` and `docs/json/`.

The TRaSH Guides are published under the MIT license. Wardarr reads their
JSON data at run time and does not ship it.
