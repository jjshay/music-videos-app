const { spawn } = require('child_process');
const path = require('path');
const brand = require('../config/brand');

// Quality presets for full render vs quick preview
const QUALITY_PRESETS = {
  full: {
    width: brand.output.width,
    height: brand.output.height,
    crf: 18,
    preset: 'medium',
  },
  preview: {
    width: brand.musicVideo.preview.width,
    height: brand.musicVideo.preview.height,
    crf: brand.musicVideo.preview.crf,
    preset: brand.musicVideo.preview.preset,
  },
};

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
 * @param {object} [quality] - Quality preset (full or preview)
 */
async function buildIntroSegment(introPng, outputFile, duration, fps = 30, quality) {
  const q = quality || QUALITY_PRESETS.full;
  const args = [
    '-y',
    '-loop', '1',
    '-t', String(duration),
    '-i', introPng,
    '-filter_complex',
    `scale=${q.width}:${q.height},fps=${fps},format=yuv420p`,
    '-c:v', 'libx264', '-crf', String(q.crf), '-preset', q.preset,
    '-an',
    outputFile,
  ];
  await runFfmpeg(args);
  return outputFile;
}

/**
 * Trim and crop a clip to vertical format at 30fps.
 * Supports Ken Burns zoom, color grading, and speed ramping.
 * Video only — audio is stripped.
 *
 * @param {string} inputFile - Source clip path
 * @param {string} outputFile - Trimmed output path
 * @param {number} duration - Segment duration in seconds (output duration)
 * @param {object} onProgress - Progress callback
 * @param {number} [seekTo=0] - Start time offset (seconds)
 * @param {object} [options] - Enhancement options
 * @param {object} [options.kenBurns] - { enabled, direction: 'in'|'out' }
 * @param {object} [options.colorGrade] - { brightness, contrast, saturation }
 * @param {number} [options.speedMultiplier] - 0.7-1.3 (1.0 = normal)
 * @param {object} [options.quality] - Quality preset
 * @param {number} [options.clipDuration] - Total clip duration for speed clamping
 * @param {string} [options.fitMode] - 'crop' (center-crop to 9:16) or 'fit' (scale to fit with padding)
 */
async function trimAndCropSegment(inputFile, outputFile, duration, onProgress, seekTo = 0, options = {}) {
  const q = options.quality || QUALITY_PRESETS.full;
  const outW = q.width;
  const outH = q.height;
  const fitMode = options.fitMode || 'crop';

  const speed = options.speedMultiplier || 1.0;
  const sourceDuration = duration / speed; // need more source for slow-mo

  // Clamp: seekTo + sourceDuration must not exceed clipDuration
  let actualSeek = seekTo;
  if (options.clipDuration && actualSeek + sourceDuration > options.clipDuration) {
    actualSeek = Math.max(0, options.clipDuration - sourceDuration);
  }

  const args = ['-y'];

  if (actualSeek > 0) {
    args.push('-ss', String(actualSeek));
  }

  args.push('-i', inputFile, '-t', String(sourceDuration));

  // Build filter chain
  const filters = [];
  const padColor = (brand.musicVideo.fitPadColor || '#1a3a6b').replace('#', '0x');

  if (fitMode === 'fit') {
    // FIT MODE: scale to fit within frame, pad with brand color
    // 2. Ken Burns with fit: scale to 2x padded size, then zoompan outputs at target
    if (options.kenBurns && options.kenBurns.enabled) {
      const mv = brand.musicVideo;
      const zoomRate = mv.kenBurnsZoomRate || 0.0015;
      const maxZoom = mv.kenBurnsMaxZoom || 1.5;
      const totalFrames = Math.round(duration * 30);

      // Scale to fit within 2x target, then pad to exactly 2x target
      filters.push(`scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=decrease`);
      filters.push(`pad=${outW * 2}:${outH * 2}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`);

      let zoomExpr;
      if (options.kenBurns.direction === 'out') {
        zoomExpr = `'if(eq(on,0),${maxZoom},max(1.0,${maxZoom}-${zoomRate}*on))'`;
      } else {
        zoomExpr = `'if(eq(on,0),1.0,min(1.0+${zoomRate}*on,${maxZoom}))'`;
      }

      filters.push(
        `zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${outW}x${outH}:fps=30`
      );
    } else {
      // No Ken Burns: scale to fit + pad
      filters.push(`scale=${outW}:${outH}:force_original_aspect_ratio=decrease`);
      filters.push(`pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=${padColor}`);
    }
  } else {
    // CROP MODE (default): center-crop to 9:16
    // 1. Crop to 9:16 aspect ratio
    filters.push(`crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'`);

    // 2. Ken Burns: scale to 2x for zoom headroom, then zoompan
    if (options.kenBurns && options.kenBurns.enabled) {
      const mv = brand.musicVideo;
      const zoomRate = mv.kenBurnsZoomRate || 0.0015;
      const maxZoom = mv.kenBurnsMaxZoom || 1.5;
      const totalFrames = Math.round(duration * 30);

      filters.push(`scale=${outW * 2}:${outH * 2}`);

      let zoomExpr;
      if (options.kenBurns.direction === 'out') {
        zoomExpr = `'if(eq(on,0),${maxZoom},max(1.0,${maxZoom}-${zoomRate}*on))'`;
      } else {
        zoomExpr = `'if(eq(on,0),1.0,min(1.0+${zoomRate}*on,${maxZoom}))'`;
      }

      filters.push(
        `zoompan=z=${zoomExpr}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${outW}x${outH}:fps=30`
      );
    } else {
      // No Ken Burns: simple scale
      filters.push(`scale=${outW}:${outH}`);
    }
  }

  // 3. Color grading
  if (options.colorGrade) {
    const cg = options.colorGrade;
    const b = cg.brightness !== undefined ? cg.brightness : 0;
    const c = cg.contrast !== undefined ? cg.contrast : 1;
    const s = cg.saturation !== undefined ? cg.saturation : 1;
    filters.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}`);
  }

  // 4. Speed ramping (setpts must come before fps)
  if (speed !== 1.0) {
    filters.push(`setpts=PTS*${(1 / speed).toFixed(4)}`);
  }

  // 5. FPS and format
  filters.push('fps=30', 'format=yuv420p');

  args.push('-filter_complex', filters.join(','));
  args.push('-c:v', 'libx264', '-crf', String(q.crf), '-preset', q.preset);
  args.push('-an', outputFile);

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
 * @param {number|Array} transitionDuration - Crossfade duration(s). Single number or per-transition array.
 * @param {object} onProgress - Progress callback
 * @param {Array} [transitionTypes] - AI-suggested transition types per cut
 * @param {object} [quality] - Quality preset
 */
async function concatenateWithCrossfade(segmentFiles, segmentDurations, outputFile, transitionDuration, onProgress, transitionTypes, quality) {
  const defaultTd = brand.musicVideo.transitionDuration;
  // Support per-transition durations: array or single number
  const tdArray = Array.isArray(transitionDuration)
    ? transitionDuration
    : null;
  const tdSingle = !tdArray ? (transitionDuration || defaultTd) : defaultTd;
  const q = quality || QUALITY_PRESETS.full;

  function getTd(i) {
    if (tdArray && tdArray[i] !== undefined) return tdArray[i];
    return tdSingle;
  }

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
  let cumulativeOverlap = 0;

  for (let i = 0; i < segmentFiles.length - 1; i++) {
    const thisTd = getTd(i);
    cumulativeTime += segmentDurations[i];
    cumulativeOverlap += thisTd;
    const offset = cumulativeTime - cumulativeOverlap;
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
      `[${currentLabel}][${nextInput}]xfade=transition=${transition}:duration=${thisTd}:offset=${offset}[${outLabel}]`
    );
    currentLabel = outLabel;
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${currentLabel}]`);
  args.push('-c:v', 'libx264', '-crf', String(q.crf), '-preset', q.preset, '-pix_fmt', 'yuv420p');
  args.push(outputFile);

  await runFfmpeg(args, onProgress);
  return outputFile;
}

/**
 * Build caption animation filter expressions.
 *
 * @param {string} type - Animation type: fade, slideUp, slideDown, fadeSlide, scaleBounce
 * @param {number} start - Caption appearance time
 * @param {number} end - Caption disappearance time
 * @param {number} fadeIn - Fade in duration
 * @param {number} fadeOut - Fade out duration
 * @returns {{ fadeFilter: string, overlayExpr: string }}
 */
function buildCaptionAnimation(type, start, end, fadeIn, fadeOut) {
  const mv = brand.musicVideo;
  const slideDist = mv.captionSlideDistance || 100;
  const animDur = mv.captionAnimDuration || 0.4;

  // Base alpha fade (always applied)
  const alphaFade = `fade=t=in:st=${start}:d=${fadeIn}:alpha=1,fade=t=out:st=${end - fadeOut}:d=${fadeOut}:alpha=1`;

  switch (type) {
    case 'slideUp': {
      // Slides up from below, alpha fade
      const yExpr = `0-max(0,(1-min(1,(t-${start})/${animDur})))*${slideDist}`;
      return {
        fadeFilter: `format=rgba,${alphaFade}`,
        overlayExpr: `overlay=0:'${yExpr}':enable='between(t,${start},${end})'`,
      };
    }

    case 'slideDown': {
      // Slides down from above, alpha fade
      const yExpr = `0+max(0,(1-min(1,(t-${start})/${animDur})))*${slideDist}`;
      return {
        fadeFilter: `format=rgba,${alphaFade}`,
        overlayExpr: `overlay=0:'${yExpr}':enable='between(t,${start},${end})'`,
      };
    }

    case 'fadeSlide': {
      // Combined alpha fade + slide up
      const yExpr = `0-max(0,(1-min(1,(t-${start})/${animDur})))*${slideDist}`;
      return {
        fadeFilter: `format=rgba,${alphaFade}`,
        overlayExpr: `overlay=0:'${yExpr}':enable='between(t,${start},${end})'`,
      };
    }

    case 'scaleBounce': {
      // Scale from 1.2x to 1.0x with bounce effect
      // We use alpha fade, then overlay centered with scale expression
      const scaleExpr = `1.0+max(0,0.2*(1-min(1,(t-${start})/${animDur})))`;
      return {
        fadeFilter: `format=rgba,${alphaFade}`,
        overlayExpr: `overlay='(W-w)/2':'(H-h)/2':enable='between(t,${start},${end})'`,
        // Note: true scale bounce requires pre-rendering at 2x and using scale expression.
        // For simplicity, we fall through to fadeSlide behavior with the overlay centered.
        // Full scaleBounce would need a separate scale filter per caption which is complex.
        // Using centered overlay + alpha fade as a practical approximation.
      };
    }

    case 'fade':
    default: {
      return {
        fadeFilter: `format=rgba,${alphaFade}`,
        overlayExpr: `overlay=0:0:enable='between(t,${start},${end})'`,
      };
    }
  }
}

/**
 * Overlay captions and mix the artist's audio onto the concatenated video.
 *
 * @param {string} videoFile - Concatenated silent video (intro + 3 segments)
 * @param {Array} captionAssets - [{ file, segmentIndex }]
 * @param {Array} segments - [{ caption, duration, startTime, captionAnimation }]
 * @param {string} audioFile - Extracted audio from artist clip
 * @param {string} outputFile - Final output path
 * @param {number} totalDuration - Total video duration (intro + segments)
 * @param {number} introDuration - Duration of the intro card
 * @param {object} onProgress - Progress callback
 * @param {object} [artistSyncInfo] - { seekTo, segmentStartTime } for audio-video lip sync
 */
async function overlayAndMixAudio(videoFile, captionAssets, segments, audioFile, outputFile, totalDuration, introDuration, onProgress, artistSyncInfo) {
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

  // Overlay each caption with animation
  captionAssets.forEach((cap, i) => {
    const inputIdx = i + 1;
    const seg = segments[cap.segmentIndex];
    const start = introDuration + seg.startTime;
    const end = introDuration + seg.startTime + seg.duration;
    const outLabel = `v${i + 1}`;

    const animType = (mv.captionAnimations && seg.captionAnimation) || 'fade';
    const anim = buildCaptionAnimation(animType, start, end, fadeIn, fadeOut);

    filters.push(`[${inputIdx}:v]${anim.fadeFilter}[cap${i}]`);
    filters.push(`[${currentLabel}][cap${i}]${anim.overlayExpr}[${outLabel}]`);
    currentLabel = outLabel;
  });

  // Audio: the artist clip's audio plays continuously.
  // Sync audio to the artist's visual position for lip sync.
  // If artistSyncInfo is provided, compute audioStart so that when the artist
  // appears on screen, the audio matches what they're performing at that frame.
  let audioStart = 0;
  if (artistSyncInfo && artistSyncInfo.seekTo) {
    const artistSeekTo = artistSyncInfo.seekTo;
    const artistSegStart = artistSyncInfo.segmentStartTime || 0;
    // At final video time (introDuration + artistSegStart), we see artist frame at seekTo.
    // So audio should be at seekTo at that moment.
    audioStart = Math.max(0, artistSeekTo - introDuration - artistSegStart);
  }

  const { fadeInDuration, fadeOutDuration, defaultVolume } = brand.music;
  const musicFadeOutStart = Math.max(0, totalDuration - fadeOutDuration);
  filters.push(
    `[${audioIndex}:a]atrim=${audioStart}:${audioStart + totalDuration},asetpts=PTS-STARTPTS,afade=t=in:d=${fadeInDuration + introDuration},afade=t=out:st=${musicFadeOutStart}:d=${fadeOutDuration},volume=${defaultVolume}[aout]`
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

/**
 * Export video to a different aspect ratio.
 *
 * @param {string} inputFile - Source 9:16 video
 * @param {string} outputFile - Output path
 * @param {string} format - '1:1' or '16:9'
 * @param {function} onProgress - Progress callback
 */
async function exportAspectRatio(inputFile, outputFile, format, onProgress) {
  let filterComplex;

  if (format === '1:1') {
    // Center crop from 1080x1920 to 1080x1080
    filterComplex = 'crop=1080:1080:0:420';
  } else if (format === '16:9') {
    // Blurred background with centered original
    filterComplex = [
      'split[a][b]',
      '[b]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=25:25[bg]',
      '[a]scale=-1:1080[fg]',
      '[bg][fg]overlay=(W-w)/2:0',
    ].join(';');
  } else {
    throw new Error(`Unsupported aspect ratio: ${format}`);
  }

  const args = [
    '-y',
    '-i', inputFile,
    '-filter_complex', filterComplex,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputFile,
  ];

  await runFfmpeg(args, onProgress);
  return outputFile;
}

/**
 * Extract a single frame from a video for thumbnail use.
 *
 * @param {string} videoFile - Source video
 * @param {number} timestamp - Seconds into video
 * @param {string} outputFile - Output image path (jpg/png)
 */
async function extractThumbnail(videoFile, timestamp, outputFile) {
  const args = [
    '-y',
    '-ss', String(timestamp),
    '-i', videoFile,
    '-vframes', '1',
    '-q:v', '2',
    outputFile,
  ];
  await runFfmpeg(args);
  return outputFile;
}

module.exports = {
  runFfmpeg,
  extractAudio,
  buildIntroSegment,
  trimAndCropSegment,
  concatenateWithCrossfade,
  overlayAndMixAudio,
  exportAspectRatio,
  extractThumbnail,
  buildCaptionAnimation,
  QUALITY_PRESETS,
  PROFESSIONAL_TRANSITIONS,
};
