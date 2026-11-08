# Tdarr

The **Tdarr** tab shows what your Tdarr servers do: the space they saved so
far, every node with its workers and the job each one runs, the queue, the
transcodes and health checks per day and the files that failed. Wardarr only
reads from Tdarr. It never starts, cancels or requeues a job; the links open
Tdarr for that.

Several Tdarr servers can be connected; the tab then has one view per server.

## Connecting

Add Tdarr under **Settings → Services** with the address of its web UI, for
example `http://tdarr:8265`. Wardarr supports Tdarr 2 and Tdarr 3.

Tdarr 3 switches authentication on for new installs, so it usually needs an API
key; an install upgraded from Tdarr 2 keeps its setting. Tdarr 2 needs a key
only when authentication is on. Create one under **Tools → API Keys** in Tdarr.

## What Wardarr reads

| Shown                        | Read from                                                   |
| ---------------------------- | ----------------------------------------------------------- |
| Version                      | `GET /api/v2/status`                                        |
| Nodes, workers, CPU, memory  | `GET /api/v2/get-nodes`, with every poll                    |
| Totals, queue, failures      | the statistics document (`/api/v2/cruddb`), with every poll |
| Space saved per library      | `POST /api/v2/stats/get-pies` (Tdarr 2.24.01 and later)     |
| Failed files                 | Tdarr's error tables (`/api/v2/client/status-tables`)       |
| Library folders, for the map | the library settings (`/api/v2/cruddb`)                     |

Libraries and failed files are read when you open the tab, at most every five
minutes (**Check again** reads them at once). Before 2.24.01, Tdarr keeps the
numbers per library in its statistics document, and Wardarr reads them from
there. Tdarr 3 is a rewrite of the server that keeps the same API. Versions
other than 2.x and 3.x run in compatibility mode, which the issue center
mentions once.

Tdarr only keeps running totals. Wardarr stores them once per day, so the
history of jobs per day and the space saved trend fill up while Wardarr runs.

## Issues

| Issue             | When                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| Node offline      | a node Wardarr saw in the last 7 days is no longer connected (after 2 min)  |
| No node connected | the server has no node at all, so nothing gets done                         |
| Files failed      | Tdarr's error tables hold files; critical with 10 or more new ones in a day |
| Jobs seem stuck   | a job's progress has not moved for 30 minutes                               |

Wardarr knows a node by its name. Tdarr gives a node a new session id each
time it starts, so a restarted node with the same name counts as the same node
and is not reported as offline. Give each node its own name in Tdarr.

A node you removed on purpose is forgotten after 7 days, and its issue
resolves; mute it in the meantime if you like.
