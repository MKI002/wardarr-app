# 0005: Notifications and languages

Status: accepted

## Notifications follow issues, not raw signals

- A notification channel listens to the Issue Center and to new requests.
  It never looks at single health messages, so one cause that touches
  several instances is still one message.
- New issues wait 60 seconds before they are announced. An issue that opens
  and resolves within that time stays quiet, which keeps short network
  blips out of your phone.
- Each channel picks a threshold for new issues (critical, warnings and up,
  all, or none). "Resolved" messages only go to channels that announced the
  issue in the first place.
- New channels only announce new issues (warnings and up), as the
  specification asks; resolved issues and pending requests are opt-in.
- Each channel sends at most 20 messages in 10 minutes. A failed send is
  retried once after 30 seconds; the last error is shown on the channel.

## Six kinds, no plugin system

Webhook (JSON, optionally signed with HMAC-SHA256), Discord, ntfy, Gotify,
Telegram and e-mail cover most setups. Apprise-style URL schemes were considered
and left out: they hide the secret inside a string that is hard to keep
write-only.

## Secrets and network

- Tokens, webhook addresses with tokens in them, signing secrets and SMTP
  passwords are stored encrypted with AES-256-GCM, bound to the channel id,
  and never sent back to the browser.
- Target addresses go through the same SSRF check as instances. Redirects
  are never followed, because several of these URLs carry a token in the
  path.
- E-mail goes out over SMTP with nodemailer. Wardarr resolves the mail
  server itself, applies the same address check, connects to the checked
  address and still verifies the TLS certificate for the host name. STARTTLS
  is the default; plain SMTP is only meant for relays inside your network.
- Links in messages point at Wardarr only when `WARDARR_PUBLIC_URL` is set.

## Languages

- English and German ship with Wardarr. The interface follows the browser
  language until a user picks one in the settings.
- Notifications are rendered on the server from the same translation files,
  in the language chosen per channel.
- A test keeps both languages in step: same keys, same placeholders, and no
  long string left untranslated.
