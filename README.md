# TV Thing for Windows

**Turn a Spotify Car Thing into a tiny TV, with the sound on your Windows PC.**

This is a Windows port of [TV Thing](https://github.com/bpmarkowitz/tvthing) by Ben Markowitz, which is
developed and tested on a Mac. The Car Thing app and the way it works are the same. The part that
runs on the computer has been changed to find and run FFmpeg on Windows.

Tune channels with the four preset buttons, turn the big knob for volume, and press it for a channel
guide. Changing channels plays analog-TV static, and CRT scanlines give the picture an old-TV look
(you can turn them off). It plays any HLS live stream (`.m3u8`) or IPTV-style M3U playlist you have
the right to watch.

> **Status: new and not yet tested on a real Windows PC with a Car Thing.** The code is tested on
> Linux, including a full FFmpeg conversion. Please [open an issue](../../issues) with the log (see
> [Troubleshooting](#troubleshooting)) if something doesn't work.

> TV Thing for Windows is an independent hobby project. It isn't affiliated with, endorsed by, or
> supported by Spotify, Bridgething, Microsoft, the original TV Thing's author, or any broadcaster or
> streaming service. See [Disclaimer](#disclaimer).

---

## What you need

| | |
| --- | --- |
| **Car Thing** | A Spotify Car Thing running **[Bridgething](https://bridgething.com)** |
| **Computer** | Windows 10 or 11 with the **Bridgething desktop app**, and the Car Thing connected |
| **Cable** | A USB cable that carries data (not charge-only), plugged straight into the PC rather than through a hub if you can |
| **FFmpeg** (optional, recommended) | Needed for streams the Car Thing can't play directly. Version 7.1 or later. See [Installing FFmpeg](#installing-ffmpeg) |

## Install

1. **Download** `TVThing-Windows-<version>.zip` from the [Releases page](../../releases).
2. **Install it in the Bridgething desktop app** as a local app. It includes a small helper (a
   Bridgething *extension*) that runs on your PC to relay streams, so Bridgething asks you to
   approve its permissions: network access, reading and writing files (for FFmpeg's temporary
   output in your Temp folder), environment variables (to find FFmpeg and the Temp folder), and
   running `ffmpeg.exe` from your PATH or one of its usual install folders.
3. **Open TV Thing for Windows on the Car Thing.** The first time, it adds a set of free channels
   so the buttons work straight away.

### Installing FFmpeg

The easiest way is [winget](https://learn.microsoft.com/windows/package-manager/winget/), which
comes with Windows 10 and 11. In a terminal (PowerShell or Command Prompt):

```
winget install Gyan.FFmpeg
```

Then **quit and restart the Bridgething desktop app** (from the system tray too), so it picks up
the new PATH. TV Thing's settings show "FFmpeg found" when it's ready.

TV Thing looks for `ffmpeg.exe` on your PATH, and in these places:

| Installed with | Location |
| --- | --- |
| winget | `%USERPROFILE%\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` |
| [Scoop](https://scoop.sh) (`scoop install ffmpeg`) | `%USERPROFILE%\scoop\shims\ffmpeg.exe` |
| [Chocolatey](https://chocolatey.org) (`choco install ffmpeg`) | `C:\ProgramData\chocolatey\bin\ffmpeg.exe` |
| A zip from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) | Unzip it so the program is at `C:\ffmpeg\bin\ffmpeg.exe`, or add its `bin` folder to your PATH |

Bridgething only lets the helper run FFmpeg from these places, so an `ffmpeg.exe` anywhere else
needs to be on your PATH.

## Adding channels

Open **TV Thing for Windows' settings** in the Bridgething desktop app.

- **Add a URL:** paste an HLS stream URL (`.m3u8`) to add one channel, or an M3U playlist URL to add every channel in it.
- **Import a file:** TV Thing **channel packs** (`.tvthing`, [format](docs/channel-packs.md)) and **M3U** playlists. Channels already in your lineup are skipped.
- **Add the free channels:** free live channels that broadcasters publish themselves (Al Jazeera English, Red Bull TV, PBS Kids, Africanews, CBS News Miami, Bloomberg Originals, France 24, DW, NHK World-Japan, Arirang, and Fox Weather), plus a test stream. Some need FFmpeg. Free streams can change or go offline at any time.

Each channel can be renamed, reordered, deleted, given one of the Car Thing's buttons 1–4, or set to always play directly or always convert. Changes reach the Car Thing straight away.

## Finding streams

TV Thing doesn't come with content. It plays streams you add. Some places to look:

- **Broadcasters' own free live streams.** Many news organizations, public broadcasters, and government channels publish free live HLS streams on their websites.
- **[iptv-org](https://github.com/iptv-org/iptv)**, a community-maintained index of publicly available streams, as M3U playlists by country, language, and category.
- **Services you subscribe to** that provide M3U or HLS URLs for use in third-party players.

**You're responsible for what you watch.** Only add streams you have the right to access, and check each source's terms of use. Many services only allow viewing through their own apps or websites. TV Thing doesn't bypass ads, logins, DRM, or geographic restrictions, and streams protected by DRM won't play.

## Using it

| Control | Action |
| --- | --- |
| Buttons 1–4 | Tune to a favorite |
| Turn the knob | Volume |
| Press the knob | Open the channel guide (turn to browse, press to watch) |
| Press the knob on the channel that's already playing | **Sound timing:** turn to shift the sound earlier or later, press when done |
| Buttons 1–4 while the guide is open | Save the highlighted channel to that button |
| Front button | Mute or unmute; the picture keeps playing (backs out of the guide or sound timing) |
| Top-right button | Show what's on (five quick presses return to Bridgething's home) |
| Tap the screen | Cycle the picture: Fill, Fit (whole picture), Zoom (removes the side bars of 4:3 shows); remembered per channel |

Settings also has CRT scanlines and sound timing.

## Troubleshooting

| Problem | Try |
| --- | --- |
| "Can't reach your computer" | Make sure the Bridgething desktop app is running and the Car Thing shows as connected. TV Thing's settings show whether its helper is running. |
| A channel won't play | Install FFmpeg (see [Installing FFmpeg](#installing-ffmpeg)) and restart Bridgething. Some streams need converting for the Car Thing. In settings, try setting the channel to **Always convert**. |
| Settings say FFmpeg isn't installed, but it is | Restart the Bridgething desktop app so it sees the updated PATH, or check `ffmpeg.exe` is in one of the [places TV Thing looks](#installing-ffmpeg). |
| Sound and picture slightly out of step | Press the knob twice (on the channel that's playing) and turn to shift the sound. It's remembered. |
| The Car Thing keeps disconnecting | Try another USB port or cable, and plug straight into the PC. |
| Anything else | Open `http://127.0.0.1:17849/api/v1/log` in a browser on the PC for the helper's recent activity, and include it when you [open an issue](../../issues). |

## How it works

```
 Car Thing                          Windows PC
┌───────────────┐  USB   ┌──────────────────────────────────────────────────┐
│ TV Thing app  │◀──────▶│ Bridgething desktop                              │
│  hls.js       │        │  ├─ TV Thing extension (127.0.0.1:17849)         │
│  picture only │        │  │    ├─ HLS relay ◀── stream source             │
│  follows the  │        │  │    └─ ffmpeg.exe (only when needed)           │
│  sound        │        │  ├─ host player: the sound, from the same relay  │
└───────────────┘        │  └─ TV Thing settings page                       │
                         └──────────────────────────────────────────────────┘
```

The extension relays each stream (converting it with FFmpeg when the Car Thing can't play it), and
both players load it from there: the Car Thing for the picture and Bridgething's host player for the
sound. The Car Thing keeps the picture in step with the sound using the stream's timestamps. The
extension only accepts connections from the PC itself. See [docs/architecture.md](docs/architecture.md).

### What's different from TV Thing

| | TV Thing (Mac) | TV Thing for Windows |
| --- | --- | --- |
| Finding FFmpeg | Homebrew and MacPorts folders, PATH | PATH, winget, Scoop, Chocolatey, `C:\ffmpeg\bin` |
| Running FFmpeg | Under a `/bin/sh` watchdog, with `pkill` for leftovers | Directly. If the helper dies, FFmpeg loses its input and exits within seconds |
| Extension permissions | `run:/bin/sh`, `run:/usr/bin/pkill` | `run:` for `ffmpeg.exe` only |
| Temporary files | `$TMPDIR` | `%TEMP%\TVThing-Transcodes` |
| Local port | 17839 | 17849, so both can be installed side by side |
| Relay | Follows `file:` links in any playlist | Follows `file:` links only in FFmpeg's own output |

The two are separate Bridgething apps with separate channel lineups. To bring your channels over,
export them from TV Thing's settings and import the file here.

## Building from source

You'll need [Node.js](https://nodejs.org) 20 or later, and [Deno](https://deno.com) for the tests
(`winget install DenoLand.Deno`). In PowerShell:

```powershell
cd app
npm install
npm run package     # typechecks, tests, builds, and zips the app → app\dist\TVThing-Windows.zip
npm test            # tests only
```

On macOS, Linux or WSL, `make`, `make test` and `make release` do the same from the top folder.

| Path | Contents |
| --- | --- |
| `app/src/device/` | The Car Thing app (TypeScript, hls.js) |
| `app/src/settings/` | The settings page, built into one self-contained `settings.html` |
| `app/src/shared/` | The lineup, channel packs, starter channels, and the API between the app and the extension |
| `app/extension/` | The extension: relay, compatibility checks, FFmpeg, and stream providers. Windows specifics are in `engine/platform.ts` |
| `app/tests/` | Tests |
| `docs/` | Architecture, channel pack format, adding stream providers |
| `examples/channel-packs/` | The starter channel pack |

**Developing without a Car Thing:** build, then run these in two terminals from `app/`:

```
npm run dev:extension
npm run dev
```

This runs the extension on its own and serves the app in a browser, with stand-ins for Bridgething.
Open `http://localhost:5173/?browser` (resize to 800×480) for the Car Thing app, or
`http://localhost:5173/settings-dev` for settings. Keys 1–4, the scroll wheel, Enter, Escape, and M
stand in for the Car Thing's controls. If the installed copy is already using port 17849, set
`TVTHING_PORT` to another port for both commands.

**Keeping up with TV Thing:** this repository keeps TV Thing's history, so its changes can be
merged in:

```
git remote add upstream https://github.com/bpmarkowitz/tvthing
git fetch upstream
git merge upstream/main
```

## Disclaimer

TV Thing for Windows is provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).

- **No content is included or hosted.** TV Thing is a player. It doesn't host or distribute video. The starter channels are links to free streams that broadcasters make publicly available themselves. All programming belongs to its owners, TV Thing isn't affiliated with any of them, and they may change or withdraw these streams at any time.
- **Use it lawfully.** You're responsible for ensuring you have the right to access any stream you add, and for following the terms of the services and sources you use.
- **No affiliation.** Spotify and Car Thing are trademarks of Spotify AB. Bridgething, Microsoft, Windows, and other names belong to their respective owners. TV Thing for Windows isn't affiliated with or endorsed by any of them, or by the original TV Thing's author.
- **Hardware:** Car Thing is discontinued hardware, and Bridgething is third-party software. Use them at your own risk.

## Credits

- **[TV Thing](https://github.com/bpmarkowitz/tvthing)** by [Ben Markowitz](https://bpmarkowitz.com)
  (MIT). This project is a port of it, and almost all of the code is his.
- **[hls.js](https://github.com/video-dev/hls.js)** (Apache 2.0) and the **[Bridgething client](https://github.com/JoeyEamigh/bridgething)**
  (MIT) are bundled in the app. Their licenses ship in its `licenses/` folder.
- **Test stream:** *Big Buck Bunny* is © Blender Foundation, licensed under
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ([peach.blender.org](https://peach.blender.org)), hosted by Mux.
- MIT licensed. See [LICENSE](LICENSE).
