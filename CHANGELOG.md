# Changelog

What has changed in Queueify. Only things you would notice are listed here -
the dashboard shows this same list under **What's new**, at
<http://127.0.0.1:3002/#changelog>.

Newest version at the top. Nothing is ever removed: a new release goes above
the others and pushes them down.

## 43.2.0

### New

- **A fresh look for the dashboard.** It matches the
  [documentation site](https://queueify-docs.vercel.app/getting-started/introduction) now, with
  the same sidebar on every page and a link straight to the docs. Light or dark follows your
  system until you pick one with the button in the header, and then it remembers
- **Spiffy, a new layout to start from.** One slim row - title, a waveform icon, artist, and a pill
  progress bar - on a gradient taken from the album art. It replaces Ticker and Spotlight under
  **Start from a layout**, which now offers Default, Spiffy, and Stacked. Themes you already made
  from either are not touched
- **A new default theme.** `!theme default` is redesigned: the album art runs flush to the left
  edge, the title is in Righteous font, the song times sit on both sides of progress bar, and the
  background is a gradient taken from the album art. It is 680 x 160 instead of 680 x 192, and
  OBS is resized to match the next time it connects. Nothing to do on your end
- **Classic is now Default.** Under **Start from a layout** it gives you the same design as the
  default theme, ready to change. Themes you already made from the old Classic are not touched

### Fixed

- **Title alignment works.** Setting the title to centred or right-aligned did nothing - it always
  sat on the left. Every text part lines up the way you set it now
- **Long centred or right-aligned lines no longer start cut off.** A title or artist too long to
  fit spilled off both edges, so it began scrolling with its first word already missing. A line
  that does not fit starts at its beginning; one that fits stays where you aligned it
- **The song times line up on long songs.** Past ten minutes, elapsed shows the same number of
  digits as the length - `07:19` against `17:05` - so both are the same width. Elapsed can sit
  flush with the text above it and still be as far from the bar as the length is. Songs under ten
  minutes look the same as before
- **Start from a layout is readable on hover.** The layout under the mouse turned solid green,
  which hid its grey description. It gets a light tint and a green border now

## 43.1.0

### New

- **Round each corner on its own.** The button beside **Corner radius** on the canvas, the album
  art and the progress bar splits it into four fields, one per corner. Click it
  again to go back to one radius

## 43.0.0

### New

- **Blur and dim the canvas.** Two sliders under the border in **Canvas**. They soften and darken
  the panel's own background and artwork, leaving the text on top sharp - and never your gameplay,
  which OBS keeps behind the page where the widget cannot see it
- **A drop shadow on any text.** A slider under **Outline**, on the title, artist and both song
  times. Angle, blur and colour appear once it is on: 0 throws it up, 180 down, blur 0 gives a hard
  offset copy
- **Icons.** Over 2,000 of them, from [Lucide](https://lucide.dev), searchable by what they are -
  "heart", "play", "mic". Add one from the parts list and it behaves like everything else: drag it,
  resize it, snap it, hide it. Colour, line weight, rotation and opacity are yours, and it takes the
  album colours too, so an icon re-tints with the artwork
- **A waveform progress bar.** Under **Progress bar → Shape**: a row of lines of differing heights
  instead of a solid bar, filling from the left as the song plays. The number of lines, the gap and
  the colours are yours, and **Shuffle** gives you a different shape
- **Place the widget without typing in chat.** **Place in OBS** in the theme editor does what
  `!tr`, `!bc`, `!tr set` and `!bc set` do - move the widget to a theme's saved spot, or remember
  where it is sitting now. Same code as the commands, so the two cannot drift apart. It says so
  when OBS is showing a different theme than the one you have open, rather than moving the wrong
  thing
- **A tidier editor.** One toolbar instead of two rows of loose buttons: the theme you are editing
  on the left, **New**, Save and **Use on stream** on the right. Backdrop, zoom, undo and **Revert
  to last save** sit on the canvas they act on - revert only when there is something to revert -
  **Start from a layout**, Duplicate, Export, Import and Delete sit under it, and the help that used
  to fill the page below the widget is behind **?**

### Fixed

- **New theme and Start from a layout are no longer the same button.** New opened the layout picker
  whenever any layout existed, so there was no way to an empty canvas. It starts a blank theme;
  the picker is still under **⋯**
- **Dropdowns are readable.** They were darker than the page behind them, and the zoom on the canvas
  drew grey numbers on a grey strip. Every field is a step lighter than its panel now, taller to
  hit, and carries the same chevron whatever the platform
- **A text outline is no longer clipped by its own box.** Half a stroke is painted outside the
  letters, and the box cut it off - flat along the top and bottom, which on the artist line read as
  a coloured bar rather than an edge. Nothing moves: the rectangle you drag is where it was

## 42.0.0

### New

- **A Stats page**, at <http://127.0.0.1:3002/stats.html>. Nothing to set up, but it only counts
  from this version on - nothing was being kept before it. It shows:
  - Songs queued, hours of music, unique artists, unique requesters
  - Top requesters, most requested songs, most requested artists
  - Why requests were turned away, by reason
  - Chat requests vs channel point redeems
  - Busiest hour of the day, and the decade mix
  - Signature song per person - the one they request most that others do not
  - Listening twins, and longest streak of streams in a row
  - Longest, shortest, oldest, newest, most obscure and best known song
  - Artists asked for exactly once, ever
  - One row per stream, split on gaps of three hours or more

  The four groups sit behind pills across the top, so each one is a screenful rather than a single
  long scroll. **Queueify** in the corner of any page is the way back to the dashboard.
- **The Admin Panel is laid out the same way.** Settings, Commands and Chat messages are pills above
  the page rather than a list down the side, and the side is just the way to everywhere else.
- **`!np` says which user queued the song.** Only when Queueify is certain it is the track it queued for
  that person - if the song came from your own playlist, or came round again later, it names the
  song and leaves it there rather than crediting the wrong viewer. The wording is yours to change in
  **Admin Panel → Chat messages**. Scrubbing around inside the song is fine - it stays the same play
  and the same person. Restarting the bot mid-song drops the credit until the next request or
  `!queue`.
- **Every command can have a cooldown**, set in **Admin Panel → Commands**. Each one shows its
  current wait beside its aliases; click it for a global wait (the whole chat) and a per-user wait
  (each person), so a room cannot take turns holding a command down. Mods are never held up, and a
  `0` turns either off. Being turned down is silent - saying "wait 12 seconds" to everyone asking
  would turn one person spamming into the bot spamming. Only `!np` starts with a wait, because it
  is the one that reaches Spotify; everything else is off until you set it.

### Fixed

- **Every number in the panel steps when you hold the button down.** The `-` and `+` beside a
  number moved it one at a time and no faster, which is a lot of clicking on a field that runs to
  3600. Holding one now repeats and speeds up the longer it is held, so a field can be crossed in a
  couple of seconds and still landed on exactly by letting go early. The waits in the theme editor
  do the same.
- **Dragging the playhead backwards no longer loses who queued the song, or counts it as played
  twice.** Any jump backwards was read as the track starting over, which credited nobody for the
  rest of the song and recorded a second play in the stats. Only a jump back to the very start
  counts as a replay now - which is still how the same song queued by two people gets credited to
  each of them in turn.

Your stats stay on your machine: the dashboard is loopback-only, nothing is uploaded, and the
record is left out of the packaged build.

## 41.0.2

### Fixed

- **Spamming `!q` no longer queues the same song several times.** Requests sent inside the same
  second all passed the cooldown check, because the cooldown was only written a second after the
  song was added. One request per person is in flight at a time now, and the cooldown is recorded
  the moment Spotify accepts the track. Redeems blocked this way are still refunded. A chat request
  and a redeem also share one cooldown, instead of the same person being tracked under two names.
  By [meislucas](https://github.com/meislucas)
- **A channel without channel points no longer reconnects in a loop.** Startup asked Twitch for the
  reward list whatever the channel was, and Twitch refuses that for anyone who is not an Affiliate
  or Partner - so setup failed, reconnected and failed again. It checks the channel type first now
  and says once that requests are chat-only. By [meislucas](https://github.com/meislucas)

## 41.0.0

### New

- **The song's time on the progress bar.** How far into the track you are on one side, how long it
  runs for on the other - `0:04 ———— 3:07`. They are ordinary parts of a theme, so they can be
  dragged, restyled or hidden like anything else. Themes made before this arrive with them off, so
  nothing you have already designed changes.
- **An outline on any text.** A hard edge around every letter, in any colour, on the title, the
  artist and both times. It is what keeps white text readable over gameplay that keeps changing
  colour, where a glow alone is not enough.
- **A theme per OBS scene.** Give a scene a theme in **Widget themes** on the dashboard and
  Queueify switches to it the moment OBS cuts to that scene. Scenes you leave alone change nothing.
- **Revert to last save.** One button in the theme editor to throw away everything since the last
  save, instead of counting undos. It goes on the undo stack, so pressing it by mistake is one
  <kbd>Ctrl</kbd>+<kbd>Z</kbd> away from being put back.
- **A warning when `!tr` / `!bc` no longer fit.** Changing a design's *shape* means its saved
  widget position can no longer frame it exactly. The editor says which one to set again, and
  names only the positions actually saved for that theme.

### Fixed

- **Switching theme no longer flashes a half-drawn widget.** Changing scene reloads the page, and
  the first frame of that reload was the design at 1x inside a browser source sized for 2x - the
  widget in one corner with empty bars beside it - followed by an empty panel until Spotify
  answered. The page now arrives already at the right zoom and stays hidden until there is a song
  to draw, so it fades in correct instead of settling into place. A zoom change no longer forces a
  reload at all, and the OBS source is only reloaded by hand when no widget is listening to reload
  itself: three reloads per scene switch became one.
- **The theme editor shows the Canvas video.** The preview drew the album cover whatever the theme
  said, so "Canvas video when available" - the one setting whose entire job is what fills that box -
  could not be seen at all. It now plays the clip for the track you are listening to, and swaps
  back the moment you choose "Album cover only".

- **Themes of a different shape are no longer squashed or cut off in OBS.** A tall theme dropped
  into the space a wide one had was given a wide, short browser source and crushed to fit it. The
  design's own proportions now decide both the size the page renders at and the space it takes on
  the canvas, so a theme is fitted into the room it had rather than stretched into it.
- **Saving a theme reaches OBS straight away.** Editing the theme already on screen used to leave
  the widget showing the old design until the source was nudged in OBS. The widget now reloads on
  every save, not only when the theme's name changes.
- **The editor's size warning tells the truth.** It compared the design against a *different*
  theme's size, so it warned about designs that were fine, stayed quiet about ones that were not,
  and never changed its mind after switching theme. It now asks OBS what the browser source
  actually is, and says nothing when there is nothing wrong.
- **"Make the OBS window this size" sticks.** It sized the source for the theme on stream rather
  than the one being edited, which undid the change the instant it was made.
- **Saved `!tr` / `!bc` positions survive a theme switch.** A position was stored as a *scale*,
  which only means anything against the browser source size it was measured at - and Queueify
  resizes that source every time the theme changes. Switching to another scene's theme and back
  therefore left the widget visibly out of place, needing the command typed again. A position now
  stores the rectangle it framed on the OBS canvas, and the scale to land in it is worked out
  fresh each time, so it comes back exactly where it was.
- **Saved positions are no longer quietly rewritten.** Every resize used to multiply every saved
  scale by the factor it had just changed by. Across two themes' worth of switches that compounded
  unevenly: real saved positions ended up with their horizontal and vertical scale 30% apart,
  stretching the widget. Nothing touches a saved position now, and the damaged ones repair
  themselves, because the scale in them is no longer read.
- **A widget you positioned by hand stays where you put it.** With no `!tr` / `!bc` position
  saved, a theme switch fitted the design into whatever rectangle the other theme had left - and
  fitting only ever shrinks, so the widget got a little smaller on every single switch, all
  stream. Queueify now remembers where each theme's widget actually was, however it got there, and
  puts it back. `!tr` and `!bc` still mean their own saved positions when you type them.
- **Switching theme puts the widget back where that theme was framed.** OBS holds a scene item by
  its top-left corner, so a widget that changes size creeps away from the bottom or the right.
  `!theme`, a scene switch and **Use on stream** all restore the theme's own saved position - and
  do it in the same pass that sizes the browser source, because OBS applies a source resize
  asynchronously: sizing first and repositioning afterwards read the old pixel count back and
  landed the widget slightly off, every time.
- **The scale sent to OBS is one number, not two.** Dividing each axis by its own ideal size
  rounds differently on each, which sent a very slightly uneven scale - enough to show after a few
  theme switches.
- **The licence is stated once.** `package.json` said ISC while the README and `LICENSE` said MIT.
  It is MIT.

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
