// SPDX-License-Identifier: LGPL-2.1-or-later
// JavaScript port created in 2026 by Dr. John (醫者小智), based on
// PulseAudio format.c, sample.c and channelmap.c (Lennart Poettering,
// Arun Raghavan, and other PulseAudio contributors).
// PCM pa_format_info <-> sample spec and channel map, for protocol v21 and later.

export const ENCODING_PCM = 1;

// pa_sample_format_to_string, indexed by pa_sample_format_t.
const SAMPLE_FORMATS = [
  "u8", "aLaw", "uLaw", "s16le", "s16be", "float32le", "float32be",
  "s32le", "s32be", "s24le", "s24be", "s24-32le", "s24-32be",
];

// pa_channel_position_to_string, indexed by pa_channel_position_t.
const POSITIONS = [
  "mono", "front-left", "front-right", "front-center", "rear-center",
  "rear-left", "rear-right", "lfe", "front-left-of-center",
  "front-right-of-center", "side-left", "side-right",
  ...Array.from({ length: 32 }, (_, i) => `aux${i}`),
  "top-center", "top-front-left", "top-front-right", "top-front-center",
  "top-rear-left", "top-rear-right", "top-rear-center",
];
const ALIASES = { left: 1, right: 2, center: 3, subwoofer: 7 };

/** A map libpulse accepts for this many channels when none was named. */
export function defaultChannelMap(channels) {
  if (channels === 1) return [0];
  if (channels === 2) return [1, 2];
  return Array.from({ length: channels }, (_, i) => 12 + i);
}

const valueOf = (props, key) => {
  const bytes = props.get(key);
  if (!bytes) return null;
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
};
// format.c stores strings as JSON strings ("\"s16le\"") and integers bare.
const unquote = (value) =>
  value?.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

function parseChannelMap(text, channels) {
  if (text === "mono" && channels === 1) return [0];
  if (text === "stereo" && channels === 2) return [1, 2];
  const positions = text.split(",").map((name) => {
    const index = POSITIONS.indexOf(name);
    return index >= 0 ? index : ALIASES[name];
  });
  return positions.length === channels && positions.every((p) => p !== undefined)
    ? positions
    : null;
}

/**
 * The stream spec for the first PCM entry of a client's format list, filling
 * whatever it leaves open from the server default, as a sink would.
 */
export function pcmFromFormats(formats, fallback) {
  const pcm = formats.find((f) => f.encoding === ENCODING_PCM);
  if (!pcm) return null;
  const sample = unquote(valueOf(pcm.props, "format.sample_format")),
    rate = Number(valueOf(pcm.props, "format.rate")),
    channels = Number(valueOf(pcm.props, "format.channels")),
    mapText = unquote(valueOf(pcm.props, "format.channel_map"));
  const spec = {
    format: sample === null ? fallback.format : SAMPLE_FORMATS.indexOf(sample),
    rate: Number.isInteger(rate) && rate > 0 ? rate : fallback.rate,
    channels:
      Number.isInteger(channels) && channels > 0 && channels <= 32
        ? channels
        : fallback.channels,
  };
  if (spec.format < 0) return null;
  const map =
    (mapText && parseChannelMap(mapText, spec.channels)) ||
    defaultChannelMap(spec.channels);
  return { spec, map };
}

/** The proplist of the PCM format_info the server settled on. */
export function pcmFormatEntries(spec, map) {
  return [
    ["format.sample_format", `"${SAMPLE_FORMATS[spec.format]}"`],
    ["format.rate", String(spec.rate)],
    ["format.channels", String(spec.channels)],
    ["format.channel_map", `"${map.map((p) => POSITIONS[p]).join(",")}"`],
  ];
}
