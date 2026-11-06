# 0009: Storage and fill-up forecast

Status: accepted

## Disks from the *arr apps, not from the host

Wardarr runs in its own container and sees none of the media disks. The *arr apps do, and they
already report mounts and free space through their API. Download clients also know their free
space, but only for the download folder; the apps cover the disks that fill up with media, so
they are the single source for now.

## Folding mounts into disks

There is no disk id in the API. Mounts of the same filesystem report the same total size to the
byte, and free space read seconds apart differs by little. Wardarr groups mounts with equal size
and free space within 1 GB (or 0.2 %), across apps and within one app. A disk keeps the key it
was first given as long as one of its mounts (app + path) is still seen, so adding or removing
an app does not cut its history.

## Hourly samples, daily forecast

Disks fill over days and weeks. One sample per disk and hour is enough to draw the history and
cheap to keep for 400 days. The forecast reduces samples to one per day and fits a Theil-Sen
line, which ignores single jumps such as a large delete; a least-squares line would bend toward
them. The projection starts from today's free space, not from the fitted line, so a cleanup
moves the date out immediately.

## One issue per disk

The issue belongs to the disk (`disk-filling-up:<key>`), not to an app. It is attached to the
first app that sees the disk, and every app that read its disks successfully counts as checked,
so the issue stays open while the apps cannot be read and resolves once they report a disk out
of range.
