# Storage

The Storage page shows every disk your *arr apps (Sonarr, Radarr, Lidarr, Readarr, Whisparr)
store media on, how full it is, how fast it fills and when it will be full at the current pace.
It needs nothing extra: the apps already report their disks.

## Where the numbers come from

Every 15 minutes Wardarr asks each app for its mounts (`/diskspace`) and its root folders
(`/rootfolder`). "Check now" on the page and "Recheck" on an issue read them at once.

Docker shows a lot of mounts that are not storage, such as `/etc/hosts` or `/dev/shm`. Wardarr
leaves out mounts smaller than 1 GB and kernel paths (`/proc`, `/sys`, `/dev`, `/run`, `/etc`).

### One disk, counted once

Sonarr may see a disk as `/tv` and Radarr the same disk as `/movies`. Wardarr folds mounts into
one disk when their size is exactly the same and their free space differs by less than 1 GB (or
0.2 % of the disk). Free space on such a disk is counted once in the totals, and a full disk is
one issue, however many apps use it. The page lists which apps use the disk and their root
folders on it.

Two separate disks of the same model and the same free space down to the last gigabyte would be
taken for one. That is rare, and it sorts itself out as soon as their free space drifts apart.

A disk with a root folder on it is a **media disk**; the others (the container's own disk, a
config volume) are listed under **Other drives**. Totals on the page and on the overview count
media disks only.

## The forecast

Wardarr stores the free space of each disk about once an hour and keeps 400 days of it. For the
forecast it takes the last value of each day over the last 30 days (adjustable) and fits a
[Theil-Sen line](https://en.wikipedia.org/wiki/Theil%E2%80%93Sen_estimator): the median of the
growth between every pair of days. One big cleanup changes only a few of those pairs, so it does
not make a disk that keeps filling look stable for a month.

From today's free space and that median growth, Wardarr works out the day the disk is full. The
quieter and busier quarters of the pairs give the likely range, shown as a soft cone in the
chart. A disk whose growth is zero or negative, or that would take more than five years, counts
as not filling up.

A forecast needs three days of history. Until then the disk shows as "learning".

## When Wardarr warns

A disk becomes an issue in the Issue Center when

| Severity | Default                                                          |
| -------- | ---------------------------------------------------------------- |
| Warning  | it will be full within 30 days, or less than 5 % is free         |
| Critical | it will be full within 7 days, or less than 2 % is free, or full |

All five numbers (both thresholds, both shares and the days the forecast looks back) can be
changed under "When Wardarr warns" on the Storage page. The issue links to the disk on the
Storage page and resolves by itself once the disk is out of the range, for example after a
cleanup. Notifications announce it like any other issue.

When an app cannot be read, its disks keep their last state and an open issue stays open until
the app answers again.

## Privacy

Disk paths and sizes describe your server, so the Storage page and its API are for admins only.
Nothing leaves your installation.
