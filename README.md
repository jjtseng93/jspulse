# jspulse

jspulse is a JavaScript/Bun port of the PulseAudio native protocol and the
Termux PulseAudio Android OpenSL ES source/sink work. It runs the protocol and
audio backend in the Bun process without starting a PulseAudio daemon.

**Hard implementation rule:** jspulse must never spawn or depend on external
audio tools or helper executables. All protocol, audio, mixer, and tone logic
must remain JavaScript running inside Bun. Native interaction is limited to
libc system calls/ioctls and Android's system OpenSL ES API through Bun FFI.
Commands such as `aplay`, `arecord`, `amixer`, `tinyplay`, and a PulseAudio
daemon are never called by jspulse, and `libasound` is not used.

It listens only
on `127.0.0.1:4713`, always accepts anonymous clients, and creates one default
source and sink automatically. It does not read or create a Pulse cookie.

```sh
bunx jspulse --alsa       # direct ALSA kernel PCM backend
bunx jspulse --sles       # Android native OpenSL ES backend
export PULSE_SERVER=127.0.0.1
paplay sound.wav
```

Play a 432 Hz sine tone for three seconds, or choose a frequency and duration:

```sh
jspulse --play
jspulse --play 442                   # 442 Hz for the default 3 seconds
jspulse --play 442x0.5              # 442 Hz for half a second
jspulse --play 442x-1               # keep playing until Ctrl-C
jspulse --alsa --play 440x1         # explicitly select ALSA
jspulse --sles --play 440x1         # explicitly select Android OpenSL ES
```

The special duration `-1` plays continuously until `Ctrl-C`; other negative
durations are rejected. The test tone uses a safe fixed 20% digital amplitude and does not start the
Pulse server. Without an explicit backend, jspulse checks for actual Android
OpenSL ES files and otherwise uses an available `/dev/snd/pcm*` device.

Run `jspulse --help` for concise CLI usage or `jspulse --readme` to render
this complete README in the terminal with `Bun.markdown.ansi`.

ALSA hardware mixer control is implemented directly with kernel ioctls; it
does not use `amixer` or `libasound`:

```sh
jspulse --volume 80                 # set playback hardware volume and exit
jspulse --mic-volume 70             # set capture hardware volume and exit
jspulse --volume                    # show current playback volume
jspulse --volume Master 60          # select Master and automatically unmute
jspulse --mic-volume Mic 70         # select a capture control
jspulse --mute Master               # hardware playback switch off
jspulse --unmute Master
jspulse --card 1 --volume 60
jspulse --audio-info                # English card/control information
jspulse --audio-info-zh             # Traditional Chinese information
```

Volume output includes `(muted)` or `(unmuted)` whenever the selected control
has a corresponding playback/capture switch, so a nonzero percentage cannot
hide the hardware mute state.

Mixer options may be combined with `--alsa`; controls are applied before the
server starts. A short control name such as `Master`, `PCM`, `Mic`, or
`Capture` is expanded to the corresponding playback/capture volume. Full
names may be quoted. Setting any numeric volume, including zero, automatically
enables the corresponding switch when one exists. The compatibility options
`--playback-control NAME` and `--capture-control NAME` are also available.
The ioctl binding checks the filesystem for an actual libc file. It prefers
Buninu's independent `/lib/libc.musl-<arch>.so.1`, then checks standard glibc
and Android bionic paths; it never guesses from an environment variable or
opens the active musl loader inode.

`--sles` drives Android's native `libOpenSLES.so` directly through Bun FFI.
It follows Termux's `module-sles-sink` engine/output-mix/buffer-queue design
and includes its own Android platform-linker namespace loader. It does not
require Termux, `libandroid-stub`, PulseAudio, tinyplay, or aplay at runtime.
`--alsa` implements the ALSA kernel PCM UAPI directly and does not require
`alsa-utils` or `libasound`.

Recording requires the Android host application that launches Bun to declare
and receive the `android.permission.RECORD_AUDIO` runtime permission. Playback
does not require that permission.

The intentionally old advertised protocol version disables shared-memory and
cookie-era extensions while remaining compatible with current libpulse. Audio
is carried inline over the same TCP connection.

## License and credits

jspulse as a whole is distributed under LGPL-2.1-or-later; see `LICENSE`.
The complete LGPL text is also kept at `LICENSES/LGPL-2.1.txt`. The Android
platform namespace loader is derived in part from Termux's NCSA-licensed
`libandroid-stub`; its permissive license is preserved at
`LICENSES/NCSA.txt`. Detailed attribution is in `NOTICE.md`.

This project directly credits the PulseAudio developers for the native
protocol, packet stream, tagstruct, source, and sink designs, and the Termux
maintainers for making PulseAudio audio output and input work on Android via
OpenSL ES. In particular, Termux's `module-sles-sink.c`,
`module-sles-source.c`, `libOpenSLES-wrapper.c`, and `platform-ns.c` provided
the practical Android behavior that this JavaScript port follows. Their work
is the reason a standalone Bun implementation can interoperate with libpulse
clients and Android's audio system.

The direct ALSA PCM parameter selection follows the LGPL-2.1-or-later
`alsa-lib` design by Abramo Bagnara and other ALSA contributors. The runtime
does not link to or load `libasound`.

- PulseAudio: https://gitlab.freedesktop.org/pulseaudio/pulseaudio
- Termux packages: https://github.com/termux/termux-packages
- ALSA library: https://github.com/alsa-project/alsa-lib
