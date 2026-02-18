const { spawn } = require('child_process');
const path = require('path');
const brand = require('../config/brand');

/**
 * Reused FFmpeg spawner — same pattern as videoCompositor.js
 */
function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (timeMatch && onProgress) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
        onProgress(secs);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const lines = stderr.trim().split('\n');
        const tail = lines.slice(-6).join('\n');
        reject(new Error(`ffmpeg exited with code ${code}: ${tail}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Extract the audio track from the artist clip.
 * This becomes the continuous soundtrack for the entire video.
 *
 * @param {string} videoFile - Source artist clip (with audio)
 * @param {string} outputFile - Extracted audio file path
 */
async function extractAudio(videoFile, outputFile) {
  const args = [
    '-y',
    '-i', videoFile,
    '-vn',                    // no video
    '-acodec', 'aac',        // AAC for compatibility
    '-b:a', '192k',
    outputFile,
  ];
  await runFfmpeg(args);
  return outputFile;
}

/**
 * Render the Gauntlet Gallery intro card as a short silent video.
 * Uses the intro card PNG (rendered by captionRenderer) and loops it.
 *
 * @param {string} introPng - Path to intro card PNG (1080x1920)
 * @param {string} outputFile - Intro video output
 * @param {number} duration - Intro duration in seconds
 * @param {number} fps - Frame rate
 */
async function buildIntroSegment(introPng, outputFile, duration, fps = 30) {
  const args = [
    '-y',
    '-loop', '1',
    '-t', String(duration),
    '-i', introPng,
    '-filter_complex',
    `fps=${fps},format=yuv420p`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-an',
    outputFile,
  ];
  await runFfmpeg(args);
  return outputFile;
}

/**
 * Trim and crop a clip to vertical 1080x1920 at 30fps.
 * Video only — audio is stripped. The artist clip's audio is handled separately.
 *
 * @param {string} inputFile - Source clip path
 * @param {string} outputFile - Trimmed output path
 * @param {number} duration - Segment duration in seconds
 * @param {object} onProgress - Progress callback
 * @param {number} [seekTo=0] - Start time offset (seconds) — Claude Vision picks the best moment
 */
async function trimAndCropSegment(inputFile, outputFile, duration, onProgress, seekTo = 0) {
  const outW = brand.output.width;
  const outH = brand.output.height;

  const args = ['-y'];

  // Seek to AI-suggested start point (before input for fast seek)
  if (seekTo > 0) {
    args.push('-ss', String(seekTo));
  }

  args.push(
    '-i', inputFile,
    '-t', String(duration),
    '-filter_complex',
    `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=${outW}:${outH},fps=30,format=yuv420p`,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-an',
    outputFile,
  );

  await runFfmpeg(args, onProgress);
  return outputFile;
}

// FFmpeg xfade transition types we support
const VALID_TRANSITIONS = [
  'fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'dissolve', 'pixelize', 'diagtl', 'diagtr', 'diagbl', 'diagbr',
];

// Curated professional subset — smooth, broadcast-quality transitions
const PROFESSIONAL_TRANSITIONS = [
  'fade', 'dissolve', 'wipeleft', 'wiperight',
  'slideup', 'slidedown', 'smoothleft', 'smoothright',
];

/**
 * Concatenate segments with crossfade transitions.
 * Includes the intro card as the first segment.
 * All segments are silent — audio is mixed in later.
 *
 * @param {Array} segmentFiles - [intro.mp4, artist.mp4, guitar.mp4, crowd.mp4]
 * @param {Array} segmentDurations - Duration of each segment
 * @param {string} outputFile - Concatenated output path
 * @param {number} transitionDuration - Crossfade duration (default 0.5s)
 * @param {object} onProgress - Progress callback
 * @param {Array} [transitionTypes] - AI-suggested transition types per cut
 */
async function concatenateWithCrossfade(segmentFiles, segmentDurations, outputFile, transitionDuration, onProgress, transitionTypes) {
  const td = transitionDuration || brand.musicVideo.transitionDuration;

  if (segmentFiles.length === 1) {
    const args = ['-y', '-i', segmentFiles[0], '-c', 'copy', outputFile];
    await runFfmpeg(args, onProgress);
    return outputFile;
  }

  const args = ['-y'];

  segmentFiles.forEach((f) => {
    args.push('-i', f);
  });

  // Build xfade chain: N segments → N-1 xfade operations
  const filters = [];
  let currentLabel = '0:v';
  let cumulativeTime = 0;

  for (let i = 0; i < segmentFiles.length - 1; i++) {
    cumulativeTime += segmentDurations[i];
    const offset = cumulativeTime - (i + 1) * td;
    const nextInput = `${i + 1}:v`;
    const outLabel = i < segmentFiles.length - 2 ? `v${i}` : 'vout';

    // Use AI-suggested transition type, fallback to 'fade'
    let transition = 'fade';
    if (transitionTypes && transitionTypes[i]) {
      const suggested = transitionTypes[i].toLowerCase();
      if (VALID_TRANSITIONS.includes(suggested)) {
        transition = suggested;
      }
    }

    filters.push(
      `[${currentLabel}][${nextInput}]xfade=transition=${transition}:duration=${td}:offset=${offset}[${outLabel}]`
    );
    currentLabel = outLabel;
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${currentLabel}]`);
  args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  args.push(outputFile);

  await runFfmpeg(args, onProgress);
  return outputFile;
}

/**
 * Overlay captions and mix the artist's audio onto the concatenated video.
 *
 * The audio is extracted from the artist clip and plays continuously
 * from the intro through all segments — like a real music video.
 *
 * @param {string} videoFile - Concatenated silent video (intro + 3 segments)
 * @param {Array} captionAssets - [{ file, segmentIndex }]
 * @param {Array} segments - [{ caption, duration, startTime }] (times relative to post-intro)
 * @param {string} audioFile - Extracted audio from artist clip
 * @param {string} outputFile - Final output path
 * @param {number} totalDuration - Total video duration (intro + segments)
 * @param {number} introDuration - Duration of the intro card
 * @param {object} onProgress - Progress callback
 */
async function overlayAndMixAudio(videoFile, captionAssets, segments, audioFile, outputFile, totalDuration, introDuration, onProgress) {
  const mv = brand.musicVideo;
  const fadeIn = mv.captionFadeIn || 0.3;
  const fadeOut = mv.captionFadeOut || 0.3;

  const args = ['-y'];

  // Input 0: concatenated video (silent)
  args.push('-i', videoFile);

  // Inputs 1..N: caption PNGs (looped)
  captionAssets.forEach((c) => {
    args.push('-loop', '1', '-t', String(totalDuration), '-i', c.file);
  });

  // Last input: extracted audio from artist clip
  const audioIndex = 1 + captionAssets.length;
  args.push('-i', audioFile);

  // Build filter chain
  const filters = [];
  let currentLabel = '0:v';

  // Overlay each caption with alpha fade
  // Caption times are offset by introDuration (they start after the intro)
  captionAssets.forEach((cap, i) => {
    const inputIdx = i + 1;
    const seg = segments[cap.segmentIndex];
    const start = introDuration + seg.startTime;
    const end = introDuration + seg.startTime + seg.duration;
    const outLabel = `v${i + 1}`;

    filters.push(
      `[${inputIdx}:v]format=rgba,fade=t=in:st=${start}:d=${fadeIn}:alpha=1,fade=t=out:st=${end - fadeOut}:d=${fadeOut}:alpha=1[cap${i}]`
    );
    filters.push(
      `[${currentLabel}][cap${i}]overlay=0:0:enable='between(t,${start},${end})'[${outLabel}]`
    );
    currentLabel = outLabel;
  });

  // Audio: the artist clip's audio plays continuously.
  // Fade in during the intro, fade out at the end.
  const { fadeInDuration, fadeOutDuration, defaultVolume } = brand.music;
  const musicFadeOutStart = Math.max(0, totalDuration - fadeOutDuration);
  filters.push(
    `[${audioIndex}:a]atrim=0:${totalDuration},asetpts=PTS-STARTPTS,afade=t=in:d=${fadeInDuration + introDuration},afade=t=out:st=${musicFadeOutStart}:d=${fadeOutDuration},volume=${defaultVolume}[aout]`
  );

  const filterStr = filters.join(';');

  args.push(
    '-filter_complex', filterStr,
    '-map', `[${currentLabel}]`,
    '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-t', String(totalDuration),
    outputFile,
  );

  await runFfmpeg(args, onProgress);
  return outputFile;
}

module.exports = {
  runFfmpeg,
  extractAudio,
  buildIntroSegment,
  trimAndCropSegment,
  concatenateWithCrossfade,
  overlayAndMixAudio,
  PROFESSIONAL_TRANSITIONS,
};
