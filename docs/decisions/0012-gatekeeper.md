# 0012: Gatekeeper

Status: accepted

## The services block, Wardarr keeps the list

Wardarr never inspects downloads itself. SABnzbd, qBittorrent, Sonarr and Radarr can already
refuse dangerous files, each in its own format. Wardarr keeps one list and writes it into each
service in that service's format. The services keep working the same when Wardarr is down.

## Only take back what Wardarr added

For every service Wardarr remembers which entries it added. Removing an extension from the list,
or switching a service off, removes only those. Entries a person added by hand stay, so the
gatekeeper can be tried and turned off again without losing anything.

## Fixed groups are reported, not hidden

Sonarr v4 and Radarr only know two fixed groups of extensions. Wardarr switches on the groups
that cover the list and shows the app as "partly" with the extensions it cannot block, instead
of pretending the whole list is active. The download client is recommended for that reason.

## A score part that only exists when it is watched

Blocked downloads lower an indexer's score through a new part, `clean = max(0, 1 − 5 ×
blocked / grabs)`, weighted 15 %. The factor 5 makes 20 % blocked grabs cost the whole part; a
handful of fakes from a busy indexer barely move it. The part is left out (null) until the
gatekeeper is set up, so existing scores and priorities do not shift for people who do not use
it.

## SABnzbd does not name the file

SABnzbd only reports "unwanted extension detected". Wardarr stores those catches with no
extension and shows them as "type unknown" rather than guessing from the list.
