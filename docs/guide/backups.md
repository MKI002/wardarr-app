# Backups

Wardarr backs up its own data: the services you connected, users, settings, issue history,
Queue Cleaner and Hunting state, TRaSH templates and play history. Your media and the services
themselves are not part of it; back those up with their own tools.

Open **Settings → Backups**.

## Smart retention

One slider decides how often Wardarr backs up and how long it keeps what. Recent backups are
kept densely, older ones thin out: one per day, then one per week, then one per month. The
page shows the sentence for the chosen level, how many backups that adds up to, how far back
they reach and roughly how much space they take, and draws the timeline of what stays.

| Level        | Backup every | Keeps                                                            | Reaches back   |
| ------------ | ------------ | ---------------------------------------------------------------- | -------------- |
| Updates only | never        | only the backups before database updates and restores            | –              |
| Light        | 24 hours     | 7 daily, 4 weekly, 3 monthly                                     | about 1 month  |
| Balanced     | 12 hours     | everything of the last 24 hours, 7 daily, 8 weekly, 7 monthly    | about 5 months |
| Thorough     | 6 hours      | everything of the last 24 hours, 14 daily, 8 weekly, 13 monthly  | about 1 year   |
| Maximum      | 3 hours      | everything of the last 48 hours, 30 daily, 12 weekly, 25 monthly | about 2 years  |

Balanced is the default. Days, weeks and months count only periods that have a backup, so a
server that was switched off for a while does not lose its older history. Moving the slider
down shows which backups the new level would remove before you save.

These backups are never removed by smart retention:

- backups you make with **Back up now** and backups you upload,
- backups you mark with **Keep forever**,
- the newest three backups made before a database update and the newest three made before a
  restore.

When less than about 200 MB is left on the backup disk, the automatic backup is skipped and
the page says so.

## Before every update

When a new Wardarr version brings a database change, Wardarr backs up the database before it
changes anything. These backups show up as **Before update**. If an update goes wrong, start
the previous image again and restore that backup.

## Restoring

Choose **Restore…** in a backup's menu. Wardarr first backs up the current state (**Before
restore**), so a restore can be undone, then restarts itself in place with the backup. Everyone
has to sign in again; login sessions are never part of a backup.

A backup from an older Wardarr version is updated to the current one after the restore. A
backup from a newer version cannot be restored; update Wardarr first.

## Moving to a new server

Stored API keys and passwords are encrypted with the installation's key (`secret.key` in the
data folder, or `WARDARR_SECRET_KEY`). A normal download keeps them encrypted with that key,
so on another installation they cannot be read and the services ask for their credentials
again.

To move everything, choose **Download with passphrase…**. The file is encrypted with your
passphrase (AES-256-GCM, key derived with scrypt) and carries the installation's key, so the new
installation can read every credential. Upload it there under **Upload backup** and restore it
with the passphrase. Without the passphrase the file cannot be opened, and nobody can recover
it.

## Where backups are stored

Backups live in `backups/` inside the data folder. Backups on the same disk do not help when
that disk dies: set `WARDARR_BACKUP_DIR` to a folder on another disk or share, or download
important backups. Each backup is a single `.wbak` file: a readable header line followed by
the compressed SQLite database.

### Restoring by hand

If Wardarr does not start at all, stop the container and restore without the web interface:

```sh
# a .wbak file is a header line and a gzip stream of the database
tail -n +3 wardarr-<date>-<kind>-<id>.wbak | gunzip > wardarr.db
```

Replace `wardarr.db` in the data folder with the result, delete `wardarr.db-wal` and
`wardarr.db-shm` next to it, and start Wardarr again. Passphrase-protected files cannot be
restored this way.
