# Quality score

The Quality score page shows how close every file in Sonarr and Radarr comes to the best file
its quality profile allows, and which custom formats are missing on the way. Wardarr never
changes files, profiles or custom formats here; the one action on the page asks Sonarr and
Radarr to search for better releases (see [Searching the worst files](#searching-the-worst-files)).

It needs Sonarr 4 or later (Sonarr 3 has no custom formats) or Radarr, with custom formats that
have scores in the quality profiles.

## Where the numbers come from

Wardarr reads, for each Sonarr and Radarr:

- the custom formats (`/customformat`) and quality profiles with their scores
  (`/qualityprofile`),
- every series (`/series`) or movie (`/movie`),
- every file with the custom formats the app matched for it and its media info
  (`/episodefile?seriesId=…` per series, `/moviefile?movieFileIds=…` in batches of 100).

Sonarr lists episode files one series at a time, so a big library takes a few minutes. The read
runs in the background, three series at a time; the page shows its progress and keeps the last
report until the new one is ready. Reports and the list of every scored file are stored, so they
survive a restart. Wardarr builds them by itself shortly after it starts and checks every 30
minutes whether one is older than 12 hours; **Check again** reads at once. While a file list is
built for the first time (after an update or for a new instance), the file list and the search
show the progress instead of an empty list.

## The perfect file

Every quality profile gets its own perfect file. Wardarr sorts each custom format into a kind
(language, audio, video codec, HDR, source, release group, subtitles, other) by its name and its
conditions. A prefix before a colon decides first (`Audio: Atmos`, `Codec: AV1`); TRaSH Guides
names (`TrueHD ATMOS`, `DV HDR10`, `German DL`) are recognised by their words.

The perfect file then has the best positive format of each kind together. Formats of the same
kind only count together when one of your files already carries them together: Dolby Vision
and HDR10 come together on many releases, Remux and WEB-DL never do. Kinds are taken as
independent of each other.

Two exceptions:

- **Repack and proper** fix a broken release. They are a bonus when a file has them, never part
  of the perfect file.
- **Formats that only ever cost points** (for example `Reject: LQ Groups` or `BR-DISK`) count as
  _unwanted_. A file that carries one shows a penalty.

The perfect score is the sum of the perfect file's formats. Each profile card on the page lists
them under **The perfect file**, so you can check the recipe.

## What the page shows

- **Library score**: the average share of the perfect score over all files, and how many files
  are perfect, have reached the profile's _upgrade until_ score (the app stops upgrading them),
  are still below it, or carry a penalty. Click a state in the bar or its legend to list its
  files, worst first, with the file name, what each file misses and a link into the app.
- **Distance to perfect**: files per tenth of the perfect score.
- **Where the points go**: the missing points per kind of custom format, the formats missing
  most often and the penalties in your library.
- **Quality profiles**: perfect score, upgrade target and the state of the files per profile.
- **What your files contain**: resolution, source, video codec, HDR, audio codec, channels,
  audio languages and subtitles, from the apps' media info.
- **Furthest from perfect**, at the bottom: series and movies with the lowest average share, what
  they miss and a link into Sonarr or Radarr, with the search for better releases above them.

With more than one instance, **All** folds them into one view; the chips above the page pick a
single instance.

## Searching the worst files

**Search for better releases** takes a number and asks Sonarr and Radarr to search for the
lowest-rated files, worst first: the lowest share of perfect, then the lowest score. With
**All** picked the worst files of every instance count together; a single instance searches
only its own. A confirmation shows the number before anything is sent.

Only files below their profile's upgrade target count, because Sonarr and Radarr would not
replace the others, and only in profiles with upgrades on. Radarr gets one `MoviesSearch` with
the movies; Sonarr gets one `EpisodeSearch` with the episodes of those files (Wardarr looks them
up with `/episode?seriesId=…` per series). At most 500 files go out in one search. Every search
uses API calls at your indexers, so start with a small number. The list is the one of the last
check; press **Check again** after the downloads to see the new scores.
