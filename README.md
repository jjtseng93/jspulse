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
