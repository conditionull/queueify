# Changelog

What has changed in Queueify. Only things you would notice are listed here -
the dashboard shows this same list under **What's new**, at
<http://127.0.0.1:3002/#changelog>.

Newest version at the top. Nothing is ever removed: a new release goes above
the others and pushes them down.

## 40.0.0

### New

- **Setup dashboard.** Connect Twitch and Spotify, create the channel point reward and point
  Queueify at OBS from one page, with a status for each. It stays open at
  <http://127.0.0.1:3002> while the bot runs, so you can come back to it whenever.
- **Admin Panel.** Change the queue's settings, rename any command, and edit every line Queueify
  says in chat - without opening a file. Everything applies straight away.
- **Visual theme editor.** Drag the album art, title, artist and progress bar around a canvas and
  save it as a real theme you can switch to with `!theme`. 50 fonts, gradients, glow, colors that
  follow the album art, and snapping that lines things up as you drag.
- **Themes can be shared.** Export a theme to a file, send it to anyone else running Queueify, and
  they can import it. It arrives as a new theme, so nothing of theirs is overwritten.
- **Twitch login without a developer app.** Approve Queueify on Twitch and you are done - no client
  ID, no secret, and logins renew themselves. Your own app keeps working if you already set one up.
- **Spotify Canvas videos.** Paste the `sp_dc` cookie on the dashboard and the widget plays
  Spotify's looping clips instead of the album cover, with a guide for finding the cookie.
- **Chat commands, listed.** The dashboard shows every command, what it does, who may use it and
  any aliases you have given it.

### Changed

- **Nothing needs a restart.** Credentials, settings, aliases, chat messages and themes are all
  re-read while the bot runs. Editing `.env` while Queueify is open now works.
- **The widget stays sharp on its own.** The old 1x / 2x / 3x setting is gone. Queueify renders the
  design at full size and lets OBS place it, and follows along when you resize it in OBS.
- **The widget reloads itself** when the bot starts and whenever a theme changes, so OBS no longer
  needs a manual refresh.
- **OBS scene and source are picked from a list** that comes from OBS itself, instead of being
  typed in - a typo used to break `!tr` and `!bc` with no explanation.
- **Missing setup is explained.** A command that cannot reach OBS says what is wrong and what to
  do about it, rather than failing silently.

### Fixed

- Turning channel point requests on or off from the Admin Panel now enables and disables the reward
  on Twitch, the way `!redeemon` and `!redeemoff` always have. It used to leave the reward live and
  viewers' points were still being taken.
- Long titles and artists scroll only when they are genuinely too long to fit, and each scrolls at
  its own speed.
- The queue no longer drifts out of step with what Spotify is actually playing.
- A song that was refused no longer costs the viewer their channel points - the redemption is
  refunded.
- The channel point reward is no longer required to start. A channel without Affiliate or
  Partner cannot make one, and setup used to wait for it forever; Queueify now runs on chat
  requests alone and says so instead of retrying in the background.

## Earlier

- Queueify did not keep a changelog before 40.0.0. Everything above is what changed once it started.
