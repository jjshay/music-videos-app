const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { probeVideo } = require('../services/videoProbe');
const { fetchCrowdClip } = require('../services/pexelsClient');
const { validateYouTubeUrl, downloadYouTube, trimClip } = require('../services/youtubeDownloader');
const { renderAllCaptions, renderIntroCard, renderOutroCard, renderBrandedThumbnail } = require('../services/captionRenderer');
const { extractAudio, buildIntroSegment, trimAndCropSegment, concatenateWithCrossfade, overlayAndMixAudio, exportAspectRatio, extractThumbnail, QUALITY_PRESETS, PROFESSIONAL_TRANSITIONS } = require('../services/musicVideoCompositor');
const { analyzeClips, extractTransitionFrames, reviewConcatenation } = require('../services/musicVideoAnalyzer');
const { detectBeats, snapDurationsToBeats } = require('../services/beatDetector');
const brand = require('../config/brand');

const router = express.Router();

// Multer storage: creates job directory, saves files with descriptive names
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req.jobId || (req.jobId = uuidv4());
    const jobDir = path.join(__dirname, '../../temp', jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'artistClip') {
      cb(null, `artist${ext}`);
    } else if (file.fieldname === 'guitarClip') {
      cb(null, `guitar${ext}`);
    } else if (file.fieldname === 'crowdClip') {
      cb(null, `crowd_custom${ext}`);
    } else {
      cb(null, file.originalname);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const videoExts = ['.mov', '.mp4', '.m4v', '.avi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!videoExts.includes(ext)) return cb(new Error('Video must be MOV, MP4, M4V, or AVI'));
    cb(null, true);
  },
});

/**
 * POST /api/music-video/youtube-download
 * SSE endpoint: download a YouTube video for an artist or guitar clip.
 * Body: { url, startTime?, endTime?, clipType: 'artist'|'guitar', jobId? }
 */
router.post('/youtube-download', express.json(), async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { url, startTime, endTime, clipType, jobId: requestedJobId } = req.body;

    if (!validateYouTubeUrl(url)) {
      send('error', { message: 'Invalid YouTube URL' });
      return res.end();
    }

    if (!clipType || !['artist', 'guitar'].includes(clipType)) {
      send('error', { message: 'clipType must be "artist" or "guitar"' });
      return res.end();
    }

    const jobId = requestedJobId || uuidv4();
    const jobDir = path.join(__dirname, '../../temp', jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    send('progress', { percent: 0, message: `Downloading ${clipType} from YouTube...`, jobId });

    const { filePath: downloadedPath, title } = await downloadYouTube(url, jobDir, {
      clipType,
      onProgress: ({ percent }) => {
        send('progress', { percent: Math.round(percent * 0.8), message: `Downloading ${clipType}: ${Math.round(percent)}%`, jobId });
      },
    });

    send('progress', { percent: 80, message: 'Download complete. Processing...', jobId });

    // Trim if start/end times provided
    const finalName = `${clipType}.mp4`;
    const finalPath = path.join(jobDir, finalName);
    let resultPath;

    const hasStart = startTime != null && startTime !== '' && startTime !== 0;
    const hasEnd = endTime != null && endTime !== '' && endTime !== 0;

    if (hasStart || hasEnd) {
      send('progress', { percent: 85, message: `Trimming ${clipType} clip...`, jobId });
      const trimStart = hasStart ? parseFloat(startTime) : null;
      const trimEnd = hasEnd ? parseFloat(endTime) : null;
      resultPath = await trimClip(downloadedPath, finalPath, trimStart, trimEnd);
    } else {
      // Rename to standard name
      fs.renameSync(downloadedPath, finalPath);
      resultPath = finalPath;
    }

    send('progress', { percent: 95, message: 'Probing video info...', jobId });

    const videoInfo = await probeVideo(resultPath);

    send('progress', { percent: 100, message: `${clipType} ready`, jobId });
    send('complete', { jobId, clipType, videoInfo, title });
    res.end();
  } catch (err) {
    console.error('YouTube download error:', err);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * POST /api/music-video/upload
 * Upload artist clip + guitar clip (+ optional crowd clip).
 * Audio is extracted from the artist clip — no separate audio upload needed.
 * Supports hybrid mode: clips may come from file upload OR prior YouTube download.
 * Pass ?jobId=<id> to reuse a job directory with YouTube-downloaded clips.
 */
router.post('/upload',
  // Pre-middleware: inherit jobId from query string so multer reuses the same directory
  (req, res, next) => {
    if (req.query.jobId) {
      req.jobId = req.query.jobId;
    }
    next();
  },
  upload.fields([
    { name: 'artistClip', maxCount: 1 },
    { name: 'guitarClip', maxCount: 1 },
    { name: 'crowdClip', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // Ensure jobId exists (multer destination sets it for file uploads;
      // pre-middleware sets it from query for YouTube-only flows)
      const jobId = req.jobId || (req.jobId = uuidv4());
      const jobDir = path.join(__dirname, '../../temp', jobId);
      fs.mkdirSync(jobDir, { recursive: true });

      // Resolve paths: uploaded file takes priority, fallback to YouTube-downloaded file
      const artistPath = (req.files.artistClip && req.files.artistClip[0])
        ? req.files.artistClip[0].path
        : path.join(jobDir, 'artist.mp4');
      const guitarPath = (req.files.guitarClip && req.files.guitarClip[0])
        ? req.files.guitarClip[0].path
        : path.join(jobDir, 'guitar.mp4');
      const crowdPath = (req.files.crowdClip && req.files.crowdClip[0])
        ? req.files.crowdClip[0].path
        : null;

      // Verify both clips exist (from upload or YouTube download)
      if (!fs.existsSync(artistPath)) {
        return res.status(400).json({ error: 'Artist clip is required — upload a file or download from YouTube' });
      }
      if (!fs.existsSync(guitarPath)) {
        return res.status(400).json({ error: 'Guitar clip is required — upload a file or download from YouTube' });
      }

      // Probe video clips
      const artistInfo = await probeVideo(artistPath);
      const guitarInfo = await probeVideo(guitarPath);

      if (!artistInfo.hasAudio) {
        return res.status(400).json({ error: 'Artist clip must have audio — this is the soundtrack for the entire video' });
      }

      const job = {
        jobId,
        type: 'music-video',
        artistPath,
        guitarPath,
        crowdPath,
        artistInfo,
        guitarInfo,
        hasCustomCrowd: !!crowdPath,
        createdAt: new Date().toISOString(),
      };

      fs.writeFileSync(path.join(jobDir, 'job.json'), JSON.stringify(job, null, 2));

      res.json({
        jobId,
        artistInfo,
        guitarInfo,
        hasCustomCrowd: !!crowdPath,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/music-video/analyze/:jobId
 * Extract frames, analyze with Claude Vision.
 * Returns: mood/genre, Pexels query for crowd, trim points, captions, transitions,
 * plus new fields: kenBurns, colorGrade, speedMultiplier, captionAnimation, heroFrame.
 */
router.post('/analyze/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../../temp', jobId);
    const jobFile = path.join(jobDir, 'job.json');

    if (!fs.existsSync(jobFile)) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

    if (req.body.artistName) {
      job.artistName = req.body.artistName;
    }

    const framesDir = path.join(jobDir, 'frames');
    const analysis = await analyzeClips(job, framesDir);

    job.analysis = analysis;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    res.json({ analysis });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/music-video/fetch-crowd/:jobId
 * Fetch crowd footage from Pexels using the AI-suggested mood query.
 * Or skip if user uploaded their own crowd clip.
 */
router.post('/fetch-crowd/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../../temp', jobId);
    const jobFile = path.join(jobDir, 'job.json');

    if (!fs.existsSync(jobFile)) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

    // If user uploaded custom crowd clip, just probe it
    if (job.hasCustomCrowd && job.crowdPath) {
      const crowdInfo = await probeVideo(job.crowdPath);
      job.crowdInfo = crowdInfo;
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
      return res.json({ source: 'custom', crowdInfo });
    }

    // Use AI-suggested query if available, otherwise default
    const aiQuery = job.analysis && job.analysis.mood ? job.analysis.mood.pexelsQuery : null;
    const query = req.body.query || aiQuery || brand.musicVideo.pexelsDefaultQuery;

    const result = await fetchCrowdClip(jobDir, query);

    if (!result) {
      return res.status(404).json({ error: 'No crowd footage found on Pexels. Upload your own instead.' });
    }

    job.crowdPath = result.filePath;
    job.crowdInfo = await probeVideo(result.filePath);
    job.pexelsData = { thumbnail: result.thumbnail, url: result.pexelsUrl, duration: result.duration, query };
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    res.json({
      source: 'pexels',
      query,
      thumbnail: result.thumbnail,
      pexelsUrl: result.url,
      duration: result.duration,
      crowdInfo: job.crowdInfo,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/music-video/preview/:jobId
 * Quick preview render: half resolution, fast preset, no captions/audio mix/review/beats.
 */
router.post('/preview/:jobId', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../../temp', jobId);
    const jobFile = path.join(jobDir, 'job.json');

    if (!fs.existsSync(jobFile)) {
      send('error', { message: 'Job not found' });
      return res.end();
    }

    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

    if (!job.crowdPath || !fs.existsSync(job.crowdPath)) {
      send('error', { message: 'Crowd footage not loaded.' });
      return res.end();
    }

    const { segments, transitions } = req.body || {};
    if (!segments || segments.length !== 3) {
      send('error', { message: 'Exactly 3 segments required' });
      return res.end();
    }

    const mv = brand.musicVideo;
    const td = mv.transitionDuration;
    const introDur = mv.introDuration;
    const outroDur = mv.outroDuration;
    const quality = QUALITY_PRESETS.preview;

    const clipPathMap = {
      artist: job.artistPath,
      guitar: job.guitarPath,
      crowd: job.crowdPath,
    };

    // Render intro + outro at preview resolution
    send('progress', { stage: 'preview', percent: 5, message: 'Rendering preview intro...' });
    const captionsDir = path.join(jobDir, 'captions');
    fs.mkdirSync(captionsDir, { recursive: true });
    const introPng = path.join(captionsDir, 'intro_card.png');
    if (!fs.existsSync(introPng)) {
      await renderIntroCard(captionsDir, brand.output.width, brand.output.height);
    }
    const introVideo = path.join(jobDir, 'preview_intro.mp4');
    await buildIntroSegment(introPng, introVideo, introDur, 30, quality);

    const outroPng = path.join(captionsDir, 'outro_card.png');
    if (!fs.existsSync(outroPng)) {
      await renderOutroCard(captionsDir, brand.output.width, brand.output.height);
    }
    const outroVideo = path.join(jobDir, 'preview_outro.mp4');
    await buildIntroSegment(outroPng, outroVideo, outroDur, 30, quality);
    send('progress', { stage: 'preview', percent: 15, message: 'Preview intro/outro ready' });

    // Trim segments at preview quality
    const sourceFiles = segments.map((seg) => clipPathMap[seg.clipType] || clipPathMap.artist);
    const segmentOutputs = [];

    for (let i = 0; i < 3; i++) {
      const segFile = path.join(jobDir, `preview_seg_${i}.mp4`);
      const seekTo = segments[i].seekTo || 0;
      const fitModeKey = `${segments[i].clipType}FitMode`;
      const fitMode = segments[i].fitMode || mv[fitModeKey] || 'crop';
      await trimAndCropSegment(sourceFiles[i], segFile, segments[i].duration, null, seekTo, { quality, fitMode });
      segmentOutputs.push(segFile);
      send('progress', { stage: 'preview', percent: 20 + (i + 1) * 20, message: `Preview: ${segments[i].clipType} trimmed` });
    }

    // Concatenate
    const allFiles = [introVideo, ...segmentOutputs, outroVideo];
    const allDurations = [introDur, ...segments.map((s) => s.duration), outroDur];

    const transitionTypes = ['fade'];
    const transitionDurations = [td]; // intro→seg1
    if (transitions) {
      transitions.forEach((t) => {
        transitionTypes.push(t.type || 'fade');
        transitionDurations.push(td);
      });
    }
    const outroTd = mv.outroTransitionDuration || 1.5;
    transitionTypes.push(mv.outroTransition || 'dissolve'); // slow dissolve into outro
    transitionDurations.push(outroTd);

    send('progress', { stage: 'preview', percent: 85, message: 'Concatenating preview...' });
    const previewFile = path.join(jobDir, 'preview.mp4');
    await concatenateWithCrossfade(allFiles, allDurations, previewFile, transitionDurations, null, transitionTypes, quality);

    send('progress', { stage: 'preview', percent: 100, message: 'Preview ready' });
    send('complete', { previewUrl: `/api/music-video/preview/${jobId}` });
    res.end();
  } catch (err) {
    console.error('Preview render error:', err);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * GET /api/music-video/preview/:jobId
 * Serve the preview video file.
 */
router.get('/preview/:jobId', (req, res) => {
  const { jobId } = req.params;
  const previewPath = path.join(__dirname, '../../temp', jobId, 'preview.mp4');
  if (!fs.existsSync(previewPath)) {
    return res.status(404).json({ error: 'Preview not found' });
  }
  res.sendFile(previewPath);
});

/**
 * POST /api/music-video/render/:jobId
 * Render the final music video — SSE progress streaming.
 *
 * Pipeline:
 * 1. Extract audio from artist clip (continuous soundtrack)
 * 2. Render intro card PNG → short video segment
 * 3. Trim + crop 3 segments (with Ken Burns, color grade, speed ramp)
 * 4. Beat-sync transition boundaries (if enabled)
 * 5. Concatenate: intro → segments → outro with AI transitions
 * 6. AI review pass
 * 7. Render caption PNGs
 * 8. Overlay captions (with animations) + mix continuous audio
 * 9. Generate branded thumbnail
 * 10. Export additional aspect ratios
 *
 * Body: { artistName, segments, transitions, outroText, exportFormats,
 *         kenBurns, colorGrade }
 */
router.post('/render/:jobId', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../../temp', jobId);
    const jobFile = path.join(jobDir, 'job.json');

    if (!fs.existsSync(jobFile)) {
      send('error', { message: 'Job not found' });
      return res.end();
    }

    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

    if (!job.crowdPath || !fs.existsSync(job.crowdPath)) {
      send('error', { message: 'Crowd footage not loaded. Fetch from Pexels or upload first.' });
      return res.end();
    }

    const { artistName, segments, transitions, outroText, exportFormats, kenBurns, colorGrade } = req.body || {};
    if (!segments || segments.length !== 3) {
      send('error', { message: 'Exactly 3 segments required' });
      return res.end();
    }

    const mv = brand.musicVideo;
    const td = mv.transitionDuration;
    const introDur = mv.introDuration;
    const outroDur = mv.outroDuration;
    const outW = brand.output.width;
    const outH = brand.output.height;

    job.artistName = artistName;
    job.segments = segments;

    const clipPathMap = {
      artist: job.artistPath,
      guitar: job.guitarPath,
      crowd: job.crowdPath,
    };

    const clipInfoMap = {
      artist: job.artistInfo,
      guitar: job.guitarInfo,
      crowd: job.crowdInfo || { duration: 30 },
    };

    // === Step 1: Extract audio from artist clip ===
    send('progress', { stage: 'trim', percent: 0, message: 'Extracting audio from artist clip...' });
    const extractedAudio = path.join(jobDir, 'extracted_audio.m4a');
    await extractAudio(job.artistPath, extractedAudio);
    send('progress', { stage: 'trim', percent: 10, message: 'Audio extracted' });

    // === Step 2: Render intro + outro cards ===
    send('progress', { stage: 'trim', percent: 12, message: 'Rendering intro card...' });
    const captionsDir = path.join(jobDir, 'captions');
    fs.mkdirSync(captionsDir, { recursive: true });
    const introPng = await renderIntroCard(captionsDir, outW, outH);
    const introVideo = path.join(jobDir, 'intro.mp4');
    await buildIntroSegment(introPng, introVideo, introDur);
    send('progress', { stage: 'trim', percent: 15, message: 'Rendering outro CTA card...' });
    const outroPng = await renderOutroCard(captionsDir, outW, outH, outroText || null);
    const outroVideo = path.join(jobDir, 'outro.mp4');
    await buildIntroSegment(outroPng, outroVideo, outroDur);
    send('progress', { stage: 'trim', percent: 18, message: 'Intro & outro cards ready' });

    // === Step 3: Trim and crop each clip segment (with Ken Burns, color grade, speed ramp) ===
    const sourceFiles = segments.map((seg) => clipPathMap[seg.clipType] || clipPathMap.artist);
    const segmentOutputs = [];

    // Merge AI analysis kenBurns/colorGrade with frontend overrides
    const aiAnalysis = job.analysis || {};
    const aiKenBurns = kenBurns || aiAnalysis.kenBurns || {};
    const aiColorGrade = colorGrade || aiAnalysis.colorGrade || {};

    for (let i = 0; i < 3; i++) {
      const seg = segments[i];
      const segFile = path.join(jobDir, `seg_${i}.mp4`);
      const seekTo = seg.seekTo || 0;

      // Build options for this segment
      const trimOptions = {};

      // Ken Burns
      const clipKb = aiKenBurns[seg.clipType];
      if (mv.kenBurnsEnabled && clipKb && clipKb.enabled) {
        trimOptions.kenBurns = { enabled: true, direction: clipKb.direction || 'in' };
      }

      // Color grade
      const clipCg = aiColorGrade[seg.clipType];
      if (mv.colorGradeEnabled && clipCg) {
        trimOptions.colorGrade = clipCg;
      }

      // Speed multiplier
      if (mv.speedRampEnabled && seg.speedMultiplier && seg.speedMultiplier !== 1.0) {
        const speed = Math.max(mv.speedRampMin, Math.min(mv.speedRampMax, seg.speedMultiplier));
        trimOptions.speedMultiplier = speed;
      }

      // Clip duration for clamping
      const clipInfo = clipInfoMap[seg.clipType];
      if (clipInfo) {
        trimOptions.clipDuration = clipInfo.duration;
      }

      // Fit mode: 'fit' for guitar (shows full product), 'crop' for others
      const fitModeKey = `${seg.clipType}FitMode`;
      trimOptions.fitMode = seg.fitMode || mv[fitModeKey] || 'crop';

      await trimAndCropSegment(sourceFiles[i], segFile, seg.duration, (secs) => {
        const pct = Math.min(100, Math.round((secs / seg.duration) * 100));
        send('progress', { stage: 'trim', percent: Math.round(20 + (i * 25) + (pct / 4)), message: `Trimming ${seg.clipType} (from ${seekTo}s)...` });
      }, seekTo, trimOptions);
      segmentOutputs.push(segFile);
      send('progress', { stage: 'trim', percent: Math.round(20 + ((i + 1) * 25)), message: `${seg.clipType} trimmed` });
    }
    send('progress', { stage: 'trim', percent: 100, message: 'All clips trimmed' });

    // === Step 4: Beat sync (adjust durations to align transitions with beats) ===
    let allDurations = [introDur, ...segments.map((s) => s.duration), outroDur];

    if (mv.beatSyncEnabled) {
      send('progress', { stage: 'beats', percent: 0, message: 'Detecting beats in audio...' });
      try {
        const artistDuration = job.artistInfo.duration;
        const beats = await detectBeats(extractedAudio, artistDuration);
        console.log(`Beat detection: found ${beats.length} beats`);
        send('progress', { stage: 'beats', percent: 50, message: `Found ${beats.length} beats` });

        if (beats.length > 0) {
          allDurations = snapDurationsToBeats(beats, allDurations, td, mv.beatSyncMaxShift);
          console.log('Beat-synced durations:', allDurations);
        }

        send('progress', { stage: 'beats', percent: 100, message: 'Beat sync complete' });
      } catch (err) {
        console.warn('Beat detection failed, skipping:', err.message);
        send('progress', { stage: 'beats', percent: 100, message: 'Beat detection failed — skipping' });
      }
    }

    // Recalculate timing after beat sync
    let runningSegTime = 0;
    const segmentsWithTime = segments.map((seg, i) => {
      const startTime = runningSegTime;
      const segDuration = allDurations[i + 1]; // +1 because allDurations[0] is intro
      runningSegTime += segDuration - (i < segments.length - 1 ? td : 0);
      return { ...seg, startTime, duration: segDuration };
    });
    const segmentsTotalDuration = runningSegTime;
    const outroTdCalc = mv.outroTransitionDuration || 1.5;
    // intro overlaps seg1 by td, last seg overlaps outro by outroTd
    const totalDuration = allDurations[0] + segmentsTotalDuration - td + allDurations[allDurations.length - 1] - outroTdCalc;

    // === Step 5: Concatenate intro + segments + outro with transitions ===
    send('progress', { stage: 'concat', percent: 0, message: 'Concatenating with transitions...' });
    const concatFile = path.join(jobDir, 'concat.mp4');

    const allFiles = [introVideo, ...segmentOutputs, outroVideo];

    // Transitions: intro→seg1 is always fade, then AI-suggested, then slow dissolve into outro
    const transitionTypes = ['fade'];
    const transitionDurations = [td]; // intro→seg1
    if (transitions) {
      transitions.forEach((t) => {
        transitionTypes.push(t.type || 'fade');
        transitionDurations.push(td);
      });
    }
    const outroTd = mv.outroTransitionDuration || 1.5;
    transitionTypes.push(mv.outroTransition || 'dissolve');
    transitionDurations.push(outroTd); // slow 1.5s dissolve into outro

    await concatenateWithCrossfade(allFiles, allDurations, concatFile, transitionDurations, (secs) => {
      const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
      send('progress', { stage: 'concat', percent: pct, message: 'Concatenating...' });
    }, transitionTypes);
    send('progress', { stage: 'concat', percent: 100, message: 'Concatenation complete' });

    // === Step 6: AI Transition Review ===
    if (mv.reviewEnabled !== false) {
      send('progress', { stage: 'review', percent: 0, message: 'Extracting transition frames for AI review...' });

      const reviewDir = path.join(jobDir, 'review_frames');
      const segmentLabels = ['intro', ...segments.map((s) => s.clipType), 'outro'];

      let reviewFrameData;
      try {
        reviewFrameData = await extractTransitionFrames(concatFile, allDurations, td, reviewDir);
        send('progress', { stage: 'review', percent: 30, message: 'Frames extracted. Sending to review AI...' });
      } catch (err) {
        console.warn('Review frame extraction failed, skipping review:', err.message);
        send('progress', { stage: 'review', percent: 100, message: 'Frame extraction failed — skipping review' });
        reviewFrameData = null;
      }

      if (reviewFrameData) {
        const moodDesc = job.analysis && job.analysis.mood ? job.analysis.mood.description : '';
        const maxRetries = mv.reviewMaxRetries || 1;
        let retries = 0;
        let approved = false;

        while (!approved && retries <= maxRetries) {
          try {
            const review = await reviewConcatenation(reviewFrameData, transitionTypes, segmentLabels, moodDesc);
            console.log(`Transition review (attempt ${retries + 1}):`, JSON.stringify(review));

            if (review.approved) {
              approved = true;
              send('progress', { stage: 'review', percent: 100, message: `AI review: ${review.overallQuality} — approved` });
            } else if (retries < maxRetries) {
              let changed = false;
              for (const t of review.transitions) {
                if (t.suggestedType && t.suggestedType !== transitionTypes[t.index] && PROFESSIONAL_TRANSITIONS.includes(t.suggestedType)) {
                  console.log(`Review fix: transition ${t.index} ${transitionTypes[t.index]} → ${t.suggestedType} (${t.issue})`);
                  transitionTypes[t.index] = t.suggestedType;
                  changed = true;
                }
              }

              if (changed) {
                send('progress', { stage: 'review', percent: 50, message: 'Re-concatenating with improved transitions...' });
                await concatenateWithCrossfade(allFiles, allDurations, concatFile, td, (secs) => {
                  const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
                  send('progress', { stage: 'review', percent: 50 + Math.round(pct / 4), message: 'Re-concatenating...' });
                }, transitionTypes);

                send('progress', { stage: 'review', percent: 75, message: 'Re-extracting frames for re-review...' });
                reviewFrameData = await extractTransitionFrames(concatFile, allDurations, td, reviewDir);
                retries++;
              } else {
                approved = true;
                send('progress', { stage: 'review', percent: 100, message: `AI review: ${review.overallQuality} — no fixes available, proceeding` });
              }
            } else {
              send('progress', { stage: 'review', percent: 100, message: `AI review: ${review.overallQuality} — max retries reached, proceeding` });
              approved = true;
            }
          } catch (err) {
            console.warn('Review AI call failed:', err.message);
            send('progress', { stage: 'review', percent: 100, message: 'Review AI error — skipping review' });
            approved = true;
          }
        }
      }
    }

    // === Step 7: Render caption overlays ===
    send('progress', { stage: 'captions', percent: 0, message: 'Rendering TikTok-style captions...' });
    const captionAssets = await renderAllCaptions(captionsDir, segmentsWithTime, outW, outH);
    send('progress', { stage: 'captions', percent: 100, message: 'Captions rendered' });

    // === Step 8: Overlay captions (with animations) + mix continuous audio ===
    send('progress', { stage: 'composite', percent: 0, message: 'Compositing final video with audio...' });
    const finalOutput = path.join(jobDir, 'final_music_video.mp4');

    // Build artist sync info for lip-sync audio alignment
    const artistSeg = segmentsWithTime.find(s => s.clipType === 'artist');
    const artistSyncInfo = artistSeg
      ? { seekTo: artistSeg.seekTo || 0, segmentStartTime: artistSeg.startTime }
      : null;

    await overlayAndMixAudio(
      concatFile,
      captionAssets,
      segmentsWithTime,
      extractedAudio,
      finalOutput,
      totalDuration,
      introDur,
      (secs) => {
        const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
        send('progress', { stage: 'composite', percent: pct, message: 'Compositing...' });
      },
      artistSyncInfo
    );
    send('progress', { stage: 'composite', percent: 100, message: 'Composite complete' });

    // === Step 9: Generate branded thumbnail ===
    if (mv.thumbnailEnabled !== false) {
      send('progress', { stage: 'thumbnail', percent: 0, message: 'Generating thumbnail...' });
      try {
        const heroFrame = aiAnalysis.heroFrame || {};
        const heroClipType = heroFrame.clipType || 'artist';
        const heroTimestamp = heroFrame.timestamp || 5;
        const heroClipPath = clipPathMap[heroClipType] || job.artistPath;

        const heroFrameFile = path.join(jobDir, 'hero_frame.jpg');
        await extractThumbnail(heroClipPath, heroTimestamp, heroFrameFile);
        send('progress', { stage: 'thumbnail', percent: 50, message: 'Hero frame extracted' });

        const thumbnailFile = path.join(jobDir, 'thumbnail.jpg');
        const guitarType = aiAnalysis.guitarType || 'Guitar';
        await renderBrandedThumbnail(heroFrameFile, thumbnailFile, artistName, guitarType, outW, outH);

        job.thumbnailPath = thumbnailFile;
        send('progress', { stage: 'thumbnail', percent: 100, message: 'Branded thumbnail ready' });
      } catch (err) {
        console.warn('Thumbnail generation failed:', err.message);
        send('progress', { stage: 'thumbnail', percent: 100, message: 'Thumbnail generation failed — skipping' });
      }
    }

    // === Step 10: Export additional aspect ratios ===
    const extraFormats = (exportFormats || []).filter((f) => f !== '9:16');
    job.exports = { '9:16': finalOutput };

    if (extraFormats.length > 0) {
      send('progress', { stage: 'export', percent: 0, message: 'Exporting additional formats...' });

      for (let i = 0; i < extraFormats.length; i++) {
        const fmt = extraFormats[i];
        const fmtLabel = fmt.replace(':', 'x');
        const exportFile = path.join(jobDir, `final_music_video_${fmtLabel}.mp4`);

        try {
          await exportAspectRatio(finalOutput, exportFile, fmt, (secs) => {
            const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
            send('progress', { stage: 'export', percent: Math.round(((i + pct / 100) / extraFormats.length) * 100), message: `Exporting ${fmt}...` });
          });
          job.exports[fmt] = exportFile;
        } catch (err) {
          console.warn(`Export ${fmt} failed:`, err.message);
        }

        send('progress', { stage: 'export', percent: Math.round(((i + 1) / extraFormats.length) * 100), message: `${fmt} export complete` });
      }

      send('progress', { stage: 'export', percent: 100, message: 'All exports complete' });
    }

    job.outputPath = finalOutput;
    job.totalDuration = totalDuration;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    const result = { downloadUrl: `/api/music-video/download/${jobId}` };
    if (job.thumbnailPath) {
      result.thumbnailUrl = `/api/music-video/thumbnail/${jobId}`;
    }
    if (Object.keys(job.exports).length > 1) {
      result.exports = {};
      for (const [fmt] of Object.entries(job.exports)) {
        result.exports[fmt] = `/api/music-video/download/${jobId}/${encodeURIComponent(fmt)}`;
      }
    }

    send('complete', result);
    res.end();
  } catch (err) {
    console.error('Music video render error:', err);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * GET /api/music-video/download/:jobId/:format?
 * Download rendered video. Optional format param for aspect ratio variants.
 */
router.get('/download/:jobId/:format?', (req, res) => {
  const { jobId, format } = req.params;
  const jobDir = path.join(__dirname, '../../temp', jobId);
  const jobFile = path.join(jobDir, 'job.json');

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

  let videoPath;
  if (format && job.exports && job.exports[decodeURIComponent(format)]) {
    videoPath = job.exports[decodeURIComponent(format)];
  } else {
    videoPath = job.outputPath;
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Rendered video not found' });
  }

  const fmtSuffix = format ? `_${decodeURIComponent(format).replace(':', 'x')}` : '';
  const filename = job.artistName
    ? `${job.artistName.replace(/[^a-zA-Z0-9]/g, '_')}_music_video${fmtSuffix}.mp4`
    : `music_video${fmtSuffix}.mp4`;
  res.download(videoPath, filename);
});

/**
 * GET /api/music-video/thumbnail/:jobId
 * Serve the branded thumbnail.
 */
router.get('/thumbnail/:jobId', (req, res) => {
  const { jobId } = req.params;
  const thumbPath = path.join(__dirname, '../../temp', jobId, 'thumbnail.jpg');
  if (!fs.existsSync(thumbPath)) {
    return res.status(404).json({ error: 'Thumbnail not found' });
  }
  res.sendFile(thumbPath);
});

module.exports = router;
