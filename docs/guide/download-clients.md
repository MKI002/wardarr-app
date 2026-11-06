# Download client checks

Wardarr asks every connected download client how it is doing, on the same
schedule as the rest of the instance poll. What a client reports turns into an
issue in the Issue Center, grouped per client.

| Check                  | Clients              | Severity | When it fires                                                                                 |
| ---------------------- | -------------------- | -------- | --------------------------------------------------------------------------------------------- |
| No network connection  | qBittorrent          | critical | The client says it is disconnected, typically because its VPN is down.                        |
| Incoming port closed   | qBittorrent, Deluge  | warning  | No peer could connect in for 30 minutes while torrents were active.                           |
| Tracker errors         | Transmission, Deluge | warning  | A tracker answers a torrent with an error. "Unregistered" torrents get their own explanation. |
| Downloads paused       | SABnzbd, NZBGet      | info     | The client is paused without a resume timer. Timed pauses end on their own and stay quiet.    |
| Download quota reached | NZBGet               | warning  | The quota for the current period is used up.                                                  |
| Warnings               | SABnzbd              | as sent  | Everything SABnzbd lists under its own warnings.                                              |
| Unreachable, login     | all                  | critical | Wardarr cannot reach the client or the login is rejected.                                     |

## Why some checks wait

qBittorrent and Deluge only learn that their port is open when a peer connects
in. Right after a restart, or when nothing is being shared, they look
firewalled although nothing is wrong. Wardarr therefore waits until the port
has looked closed for 30 minutes and only reports it while torrents are
active.

A pause with no timer is shown as info, so it does not trigger a notification
with the default threshold. If a schedule pauses a client on purpose, mute the
issue.

## What is not checked

- Tracker errors in qBittorrent: its API only reports tracker status per
  torrent and tracker, which would mean one extra call per torrent.
- The listening port of Transmission: its port test asks an outside server,
  and Wardarr does not make calls like that on your behalf.
- Free disk space is not part of these checks.
