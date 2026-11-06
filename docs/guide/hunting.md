# Hunting

Hunting searches missing titles and upgrades at a calm pace, so your
indexers are not flooded.

## Pace

| Pace             | Missing    | Upgrades        |
| ---------------- | ---------- | --------------- |
| Off              | none       | none            |
| Gentle           | 1 per hour | 1 every 4 hours |
| Normal (default) | 2 per hour | 1 every 2 hours |
| Fast             | 5 per hour | 1 per hour      |

The exact values can be changed under **Advanced**.

## Limits

- At most 100 API calls per hour and instance.
- Pauses while 15 or more downloads are in the queue.
- A title is searched again at the earliest after 30 days.
- Only monitored titles.
- Pauses and names the reason when an indexer fails.
- Skips titles whose Queue Cleaner attempts are used up.

Filters for tags, quality profiles and years are under **Advanced**.

## What you see

- **Up next**: the next titles, why each was picked, and when.
- **Results**: whether a search found something, downloaded and imported,
  read from the *arr history.
- **Success rate** per instance over the last 30 days.
- Per title: **Search now** and **Exclude**.
