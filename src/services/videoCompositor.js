const { spawn } = require('child_process');
const path = require('path');
const brand = require('../config/brand');

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // Parse progress from stderr
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

async function buildIntro(introImage, sourceVideo, outputFile, fps, videoInfo, onProgress) {
  const introDuration = brand.intro.duration;
  const fadeDuration = brand.intro.fadeDuration;
  const fadeOffset = introDuration - fadeDuration;
  const outW = brand.output.width;
  const outH = brand.output.height;

  // Intro PNG is already at output resolution (1080x1920)
  // Source video needs center-crop from landscape to 9:16 portrait, then scale to output
  // crop=ih*9/16:ih:(iw-ih*9/16)/2:0 crops to 9:16 from center of landscape
  const args = [
    '-y',
    '-loop', '1', '-t', String(introDuration), '-i', introImage,
    '-i', sourceVideo,
    '-filter_complex',
    [
      `[0]scale=${outW}:${outH},fps=${fps},format=yuv420p[i]`,
      `[1]crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${outW}:${outH},fps=${fps},format=yuv420p[v]`,
      `[i][v]xfade=transition=fade:duration=${fadeDuration}:offset=${fadeOffset}[out]`,
    ].join(';'),
    '-map', '[out]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    outputFile,
  ];

  await runFfmpeg(args, (secs) => {
    if (onProgress) onProgress('intro', 0);
  });

  if (onProgress) onProgress('intro', 100);
  return outputFile;
}

async function compositeOverlays(introVideo, overlayAssets, musicPath, outputFile, videoInfo, onProgress) {
  const rawDuration = videoInfo.duration + brand.intro.duration;
  const totalDuration = brand.output.maxDuration
    ? Math.min(rawDuration, brand.output.maxDuration)
    : rawDuration;
  const introEnd = brand.intro.duration;
  const outW = brand.output.width;
  const outH = brand.output.height;

  const args = ['-y'];

  // Input 0: intro video (already at output resolution, video only)
  args.push('-i', introVideo);

  // Input 1: watermark PNG — looped
  args.push('-loop', '1', '-t', String(totalDuration), '-i', overlayAssets.watermark);

  // Inputs 2..N: callout PNGs — each looped
  overlayAssets.callouts.forEach((c) => {
    args.push('-loop', '1', '-t', String(totalDuration), '-i', c.file);
  });

  // Music input (last)
  const musicIndex = 2 + overlayAssets.callouts.length;
  args.push('-i', musicPath);

  // Build filter chain
  const filters = [];
  let currentLabel = '0:v';

  // Watermark: persistent after intro
  filters.push(`[1:v]format=rgba[wm]`);
  filters.push(`[${currentLabel}][wm]overlay=0:0:enable='gte(t,${introEnd})'[v1]`);
  currentLabel = 'v1';

  // Callout overlays with alpha fade in/out
  overlayAssets.callouts.forEach((callout, i) => {
    const inputIdx = i + 2;
    const fadeIn = 0.5;
    const fadeOut = 0.5;
    const start = callout.time;
    const end = callout.time + callout.duration;
    const outLabel = `v${i + 2}`;

    filters.push(
      `[${inputIdx}:v]format=rgba,fade=t=in:st=${start}:d=${fadeIn}:alpha=1,fade=t=out:st=${end - fadeOut}:d=${fadeOut}:alpha=1[co${i}]`
    );
    filters.push(
      `[${currentLabel}][co${i}]overlay=0:0:enable='between(t,${start},${end})'[${outLabel}]`
    );
    currentLabel = outLabel;
  });

  // Audio: music with fade in/out
  const { fadeInDuration, fadeOutDuration, defaultVolume } = brand.music;
  const musicFadeOutStart = Math.max(0, totalDuration - fadeOutDuration);
  filters.push(
    `[${musicIndex}:a]afade=t=in:d=${fadeInDuration},afade=t=out:st=${musicFadeOutStart}:d=${fadeOutDuration},volume=${defaultVolume}[aout]`
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

  await runFfmpeg(args, (secs) => {
    const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
    if (onProgress) onProgress('composite', pct);
  });

  return outputFile;
}

module.exports = { buildIntro, compositeOverlays };
