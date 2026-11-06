# Calendar

The calendar ("What's coming") collects the calendars of every connected Sonarr, Radarr, Lidarr
and Readarr. Everyone with an account can open it, so the whole household sees what comes next.

## What it shows

- **Episodes** with their air time, season and episode number, and premieres and finales.
- **Films** with up to three dates each: in cinemas, digital release and Blu-ray & DVD.
- **Albums** and **books** on their release day.

Only monitored titles appear, the same as in the *arr calendars. When the same release sits in
two instances, for example an HD and a 4K Sonarr, it shows once and names both. An entry is marked
**Downloaded** when any instance has the file, and **Missing** when it is out but no instance has
it yet. Cinema releases are never missing, because there is nothing to download yet.

The page opens with the number of releases in the next seven days, what comes next, and a strip
of the next two weeks. Below it are a list and a month view, with filters per kind and an option
to hide what is already downloaded. Wardarr asks the services again at most every five minutes.

Whisparr is left out on purpose: the calendar is meant for everyone in the household.

## Calendar apps (iCal)

Under **Calendar app** each person can create a link to subscribe to in Google Calendar, Apple
Calendar, Outlook or Thunderbird. The feed covers two weeks back and three months ahead, uses the
person's language and asks calendar apps to refresh it every hour.

Calendar apps cannot log in, so the link itself is the key:

- It contains a random token of 256 bits. Wardarr stores only its SHA-256 hash and shows the link
  once, right after it was made.
- **New link** replaces the old one, which stops working at once. **Revoke** removes it.
- The link stops working when its account is disabled or deleted.
- Admins see every link in the household, when it was made and last fetched, and can revoke any of
  them.
- The feed answers at most 30 requests per minute per address, and unknown tokens get a plain
  404\. Tokens are masked in Wardarr's logs.

Set `WARDARR_PUBLIC_URL` when Wardarr runs behind a reverse proxy, so the link carries the address
people use from outside.
