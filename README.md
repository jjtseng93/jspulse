# jspulse

jspulse is a JavaScript/Bun port of the PulseAudio native protocol and the
Termux PulseAudio Android OpenSL ES source/sink work. It runs the protocol and
audio backend in the Bun process without starting a PulseAudio daemon.

It listens only
on `127.0.0.1:4713`, always accepts anonymous clients, and creates one default
source and sink automatically. It does not read or create a Pulse cookie.

```sh
bunx jspulse --alsa       # aplay / arecord backend
bunx jspulse --sles       # Android native OpenSL ES backend
export PULSE_SERVER=127.0.0.1
paplay sound.wav
```

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
`--alsa` requires `alsa-utils`.

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

- PulseAudio: https://gitlab.freedesktop.org/pulseaudio/pulseaudio
- Termux packages: https://github.com/termux/termux-packages
