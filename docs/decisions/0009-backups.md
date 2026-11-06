# 0009: Backups and smart retention

Status: accepted

## One slider instead of a schedule form

Backup tools usually ask for a schedule, a number of versions and a maximum age. Most people
pick something and never look again, and the combination they pick rarely matches what they
want: recent history in detail, older history in coarse steps. Wardarr offers five levels on
one slider. Each level is a fixed policy (interval, keep-everything window, daily, weekly and
monthly counts) in `packages/core/src/backups/retention.ts`. The same code runs in the server,
which deletes backups, and in the web UI, which previews what a level keeps and which existing
backups a lower level would remove before it is saved.

Buckets follow the "newest backup of each of the last N periods that have one" rule, as in
restic. A server that was off for weeks keeps its older backups, and applying the plan after
every backup ends in the same set as applying it once to the full history (tested).

Manual and uploaded backups, pinned ones and the newest three safety backups per kind are
never removed by retention. Deleting them is a decision for a person.

## A consistent copy while the server runs

`VACUUM INTO` writes a consistent, compact copy of the live database without stopping
anything. Login sessions are deleted from the copy with `secure_delete`, so a downloaded backup
holds no session ids. The file format is a header line (JSON: creation time, kind, app version,
applied migration hashes, size, SHA-256, key fingerprint) followed by the gzip-compressed
database. The header can be read without decompressing, the checksum catches damaged files,
and a person can restore by hand with `tail` and `gunzip`.

## Settings outside the database

The backup level and the pins live in `settings.json` next to the backups, not in the
database. A restore must not change the backup policy, and the backup before a migration is
written before the database is usable.

## Backup before migrations

`openDatabase` compares the applied migrations with the bundled ones using the migrator's own
rule. When migrations are pending on an existing database, it backs the database up before
running them. A new, empty database is not backed up.

## Credentials and keys

Credentials in the database are encrypted with the installation key. A plain backup keeps them
that way and carries only a fingerprint of the key. Restoring it on an installation with
another key would leave unreadable credentials behind, so Wardarr asks first and then replaces
them with empty ones; the services then ask for their credentials again instead of failing on
every poll.

A passphrase-protected export encrypts the whole payload with AES-256-GCM under a key derived
with scrypt (N = 2^15, r = 8), authenticates the header line as additional data and carries the
installation key inside the encrypted part. Restoring it re-encrypts every credential with the
target installation's key, so moving to a new server keeps all API keys without copying
`secret.key` by hand. The key never leaves the server unencrypted.

## Restore by restarting in place

Services keep state in memory (issues, runtime snapshots, schedulers). Swapping the database
under them would leave that state stale, and relying on the container's restart policy would
leave Unraid users without a running Wardarr. A restore therefore stages the database next to
the live one, backs up the current state, answers the request and restarts the whole server
inside the same process: jobs stop, the HTTP server closes (open event streams are closed with
it), the staged file replaces the database, and everything starts again, migrations included.
If that restart fails, the process exits and the staged restore is applied on the next start.
