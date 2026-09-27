# Notices

jspulse is licensed under LGPL-2.1-or-later; see `LICENSE`.

The PulseAudio native-protocol implementation and Android OpenSL ES backend
were independently translated to JavaScript with reference to the projects
below. No PulseAudio or Termux binary is redistributed.

The JavaScript port and modifications were made in 2026 by Dr. John
(醫者小智). Original copyright and authorship remain with the upstream
contributors identified below and in the source-file notices.

## PulseAudio

- Upstream: https://gitlab.freedesktop.org/pulseaudio/pulseaudio
- Referenced files: `src/pulsecore/protocol-native.c`, `pstream.c`,
  `tagstruct.c`, and related public headers
- License: LGPL-2.1-or-later
- Full text: `LICENSES/LGPL-2.1.txt`
- Original authors include Lennart Poettering and Pierre Ossman, together
  with the other PulseAudio contributors.

## Termux packages

- Upstream: https://github.com/termux/termux-packages
- Referenced files: `packages/pulseaudio/module-sles-sink.c`,
  `module-sles-source.c`, and `packages/libandroid-stub/platform-ns.c`
- License for the referenced PulseAudio modules: LGPL-2.1-or-later
- Full text: `LICENSES/LGPL-2.1.txt`
- The OpenSL ES modules credit Lennart Poettering, Nathan Martynov, Patrick
  Gaskin, and other Termux/PulseAudio contributors.
- `packages/libandroid-stub/platform-ns.c` is NCSA-licensed; the JavaScript
  port preserves that notice in `LICENSES/NCSA.txt`.

## ALSA

- Upstream: https://github.com/alsa-project/alsa-lib
- Referenced files: `src/pcm/pcm_params.c` and `src/pcm/interval.c`
- Referenced kernel UAPI: `include/uapi/sound/asound.h`
- License for the userspace parameter-selection design: LGPL-2.1-or-later
- Full text: `LICENSES/LGPL-2.1.txt`
- The JavaScript PCM backend follows the `HW_REFINE`/`HW_PARAMS` selection
  order designed by Abramo Bagnara and other ALSA contributors, and chooses
  interval values with the `snd_interval_refine_first`/`last` semantics of
  `interval.c` so open (non-integer) intervals stay valid. Kernel UAPI
  constants and layouts are used only as the public Linux userspace ABI; no
  ALSA kernel implementation code is redistributed.

## Sun Microsystems G.711 codec

- Referenced file: `g711.c` (Sun Microsystems, Inc.), the widely
  redistributed reference A-law/μ-law implementation
- Used by: `lib/pcm-convert.js` (A-law/μ-law encode and decode)
- License: the original notice states that the code "is provided for
  unrestricted use. Users may copy or modify this source code without
  charge." It is provided as is, with no warranties, and Sun Microsystems
  shall have no liability arising from its use.

Android and OpenSL ES are trademarks of their respective owners. Android
system libraries are loaded from the device and are not distributed here.
