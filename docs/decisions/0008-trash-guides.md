# 0008: TRaSH Guides sync

Status: accepted

## Templates between the guide and the instances

Tools like Recyclarr describe each instance in a YAML file. Wardarr puts a
template in between: it names TRaSH profiles, format groups, own scores,
sizes and naming, and any number of instances of the same product use it.
Changing the template changes every instance after its preview, and two
Radarrs with the same setup do not drift apart. The template stores only
trash ids and your own choices; scores, conditions and qualities are resolved
from the current guide at sync time, so a guide update reaches every instance
without editing the template.

## A diff of fields, not of objects

Every managed object (custom format, quality profile, quality sizes, naming)
is reduced to a flat map of fields, such as `score:<trash id>` or `cutoff`.
The plan compares the desired map with the instance and with the state
Wardarr applied last. That last state tells where a difference comes from: if
the instance still has what Wardarr applied, the guide or template changed; if
not, someone changed the instance. The origin decides what the guard may do
on its own and is shown in the preview, so an admin sees why each field
changes.

Only fields the guide defines are compared. Settings Wardarr does not manage
(for example extra custom formats with score 0, or qualities a profile does
not allow) are left alone and do not count as drift.

## Backups and rollbacks instead of trust

Every sync stores the affected objects as they were before, the ids Wardarr
manages and the applied state. A rollback restores them, removes objects the
sync created and maps custom format ids by name, because a recreated format
gets a new id. A sync stops at the first error and records what was done, so
a partial sync can be rolled back as well.

## The guard pauses instead of guessing

Auto sync only applies changes whose origin is the guide or the template.
Strict mode also sets back changes made in the instance. Both stop and wait for
an admin when a change is large (many objects, a different cutoff or quality
list, removals) or when the same field is set back again and again, which
means another tool fights over it. Notify is the default, because the most
common setup still has Recyclarr or Notifiarr running next to Wardarr.

## Guide data at run time

The guide JSON is fetched from GitHub with two API calls (latest commit, file
tree) and raw downloads of changed files only, and stored in the database, so
a GitHub outage does not stop syncs. `WARDARR_TRASH_DIR` replaces the
download with a local folder for offline installations; tests, the end-to-end
suite and the demo use invented data in `testbed/trash-guides`. The parser is
lenient: a file it does not understand is skipped and listed, so one odd file
in a new guide version does not break the rest. No guide data and no code of
other sync tools is part of Wardarr.

## German custom formats

TRaSH has German profiles that already include the German language and
release group formats. Wardarr offers them like any other profile and does not
add German formats to other profiles on its own; a template can add any custom
format with an own score.
