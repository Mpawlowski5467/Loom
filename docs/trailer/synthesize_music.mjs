#!/usr/bin/env node

import fs from "node:fs";

const outputPath = process.argv[2];
const durationSeconds = Number(process.argv[3] ?? 50);
if (!outputPath || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
  throw new Error("Usage: node synthesize_music.mjs OUTPUT.wav [SECONDS]");
}

const sampleRate = 48_000;
const channels = 2;
const frameCount = Math.ceil(durationSeconds * sampleRate);
const samples = new Float32Array(frameCount * channels);

const chords = [
  [130.81, 196.0, 246.94, 329.63], // Cmaj7
  [110.0, 164.81, 196.0, 261.63], // Am7
  [87.31, 130.81, 164.81, 220.0], // Fmaj7
  [98.0, 146.83, 220.0, 293.66], // Gsus2
  [82.41, 123.47, 146.83, 196.0], // Em7
  [110.0, 164.81, 220.0, 261.63], // Am
  [87.31, 130.81, 174.61, 220.0], // F
  [98.0, 146.83, 196.0, 293.66], // G
];

const chordSeconds = 6;
const noteSeconds = 0.75;

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function chordWeight(localTime) {
  const fade = 0.9;
  const attack = smoothstep(localTime / fade);
  const release = smoothstep((chordSeconds - localTime) / fade);
  return Math.min(attack, release);
}

for (let frame = 0; frame < frameCount; frame += 1) {
  const time = frame / sampleRate;
  const chordIndex = Math.floor(time / chordSeconds) % chords.length;
  const chord = chords[chordIndex];
  const localChordTime = time % chordSeconds;
  const padEnvelope = chordWeight(localChordTime);

  let left = 0;
  let right = 0;

  for (let voice = 0; voice < chord.length; voice += 1) {
    const frequency = chord[voice];
    const detune = voice % 2 === 0 ? 0.997 : 1.003;
    const phase = voice * 0.83;
    const fundamental =
      Math.sin(2 * Math.PI * frequency * time + phase) +
      0.36 * Math.sin(2 * Math.PI * frequency * 2 * time + phase * 0.7) +
      0.14 * Math.sin(2 * Math.PI * frequency * 3 * time + phase * 1.3);
    const companion = Math.sin(
      2 * Math.PI * frequency * detune * time + phase + 0.4,
    );
    const signal = (fundamental * 0.62 + companion * 0.38) * padEnvelope;
    const pan = voice / (chord.length - 1);
    left += signal * (1 - pan * 0.55);
    right += signal * (0.45 + pan * 0.55);
  }

  const noteIndex = Math.floor(time / noteSeconds);
  const noteTime = time % noteSeconds;
  const melodyChord = chords[Math.floor(time / chordSeconds) % chords.length];
  const pattern = [0, 2, 1, 3, 2, 1, 3, 1];
  const melodyFrequency =
    melodyChord[pattern[noteIndex % pattern.length]] * 2;
  const pluckEnvelope = Math.exp(-noteTime * 5.5) * smoothstep(noteTime / 0.03);
  const pluck =
    Math.sin(2 * Math.PI * melodyFrequency * time) * 0.18 * pluckEnvelope;
  const pluckPan = 0.5 + 0.35 * Math.sin(noteIndex * 1.7);
  left += pluck * (1 - pluckPan * 0.55);
  right += pluck * (0.45 + pluckPan * 0.55);

  const pulse = Math.sin(2 * Math.PI * 0.5 * time);
  const motion = 0.88 + 0.12 * pulse;
  samples[frame * channels] = left * 0.075 * motion;
  samples[frame * channels + 1] = right * 0.075 * motion;
}

let peak = 0;
for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
const gain = peak > 0 ? 0.72 / peak : 1;

const bytesPerSample = 2;
const dataSize = frameCount * channels * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(channels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
buffer.writeUInt16LE(channels * bytesPerSample, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataSize, 40);

for (let index = 0; index < samples.length; index += 1) {
  const value = Math.max(-1, Math.min(1, samples[index] * gain));
  buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
}

fs.writeFileSync(outputPath, buffer);
