# jspulse

A small PulseAudio native-protocol v8 server written for Bun. It listens only
on `127.0.0.1:4713`, always accepts anonymous clients, and creates one default
source and sink automatically. It does not read or create a Pulse cookie.

```sh
bunx jspulse --alsa       # aplay / arecord backend
bunx jspulse --sles       # Android tinyplay / tinycap backend
export PULSE_SERVER=127.0.0.1
paplay sound.wav
```

`--sles` uses Android's `tinyplay` and `tinycap` path, with ALSA tools as a
fallback on non-Android development hosts. `--alsa` requires `alsa-utils`.

The intentionally old advertised protocol version disables shared-memory and
cookie-era extensions while remaining compatible with current libpulse. Audio
is carried inline over the same TCP connection.
