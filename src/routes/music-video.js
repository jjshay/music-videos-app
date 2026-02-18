const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { probeVideo } = require('../services/videoProbe');
const { fetchCrowdClip } = require('../services/pexelsClient');
const { renderAllCaptions, renderIntroCard, renderOutroCard } = require('../services/captionRenderer');
const { extractAudio, buildIntroSegment, trimAndCropSegment, concatenateWithCrossfade, overlayAndMixAudio, PROFESSIONAL_TRANSITIONS } = require('../services/musicVideoCompositor');
const { analyzeClips, extractTransitionFrames, reviewConcatenation } = require('../services/musicVideoAnalyzer');
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
 * POST /api/music-video/upload
 * Upload artist clip + guitar clip (+ optional crowd clip).
 * Audio is extracted from the artist clip — no separate audio upload needed.
 */
router.post('/upload',
  upload.fields([
    { name: 'artistClip', maxCount: 1 },
    { name: 'guitarClip', maxCount: 1 },
    { name: 'crowdClip', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const jobId = req.jobId;
      const jobDir = path.join(__dirname, '../../temp', jobId);

      if (!req.files.artistClip || !req.files.guitarClip) {
        return res.status(400).json({ error: 'Artist clip and guitar clip are required' });
      }

      const artistPath = req.files.artistClip[0].path;
      const guitarPath = req.files.guitarClip[0].path;
      const crowdPath = req.files.crowdClip ? req.files.crowdClip[0].path : null;

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
 * Returns: mood/genre, Pexels query for crowd, trim points, captions, transitions.
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
 * POST /api/music-video/render/:jobId
 * Render the final music video — SSE progress streaming.
 *
 * Pipeline:
 * 1. Extract audio from artist clip (continuous soundtrack)
 * 2. Render intro card PNG → short video segment
 * 3. Trim + crop 3 segments (artist, guitar, crowd)
 * 4. Concatenate: intro → artist → guitar → crowd with AI transitions
 * 5. Render caption PNGs
 * 6. Overlay captions + mix continuous audio
 *
 * Body: { artistName, segments: [{ clipType, caption, duration, seekTo }], transitions: [{ type }] }
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

    const { artistName, segments, transitions, outroText } = req.body || {};
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

    // === Step 3: Trim and crop each clip segment ===
    const sourceFiles = segments.map((seg) => clipPathMap[seg.clipType] || clipPathMap.artist);
    const segmentOutputs = [];

    for (let i = 0; i < 3; i++) {
      const segFile = path.join(jobDir, `seg_${i}.mp4`);
      const seekTo = segments[i].seekTo || 0;
      await trimAndCropSegment(sourceFiles[i], segFile, segments[i].duration, (secs) => {
        const pct = Math.min(100, Math.round((secs / segments[i].duration) * 100));
        send('progress', { stage: 'trim', percent: Math.round(20 + (i * 25) + (pct / 4)), message: `Trimming ${segments[i].clipType} (from ${seekTo}s)...` });
      }, seekTo);
      segmentOutputs.push(segFile);
      send('progress', { stage: 'trim', percent: Math.round(20 + ((i + 1) * 25)), message: `${segments[i].clipType} trimmed` });
    }
    send('progress', { stage: 'trim', percent: 100, message: 'All clips trimmed' });

    // === Step 4: Concatenate intro + 3 segments with transitions ===
    send('progress', { stage: 'concat', percent: 0, message: 'Concatenating with transitions...' });
    const concatFile = path.join(jobDir, 'concat.mp4');

    // All files: intro first, then segments in order, then outro
    const allFiles = [introVideo, ...segmentOutputs, outroVideo];
    const allDurations = [introDur, ...segments.map((s) => s.duration), outroDur];

    // Transitions: intro→seg1 is always fade, then AI-suggested for rest, then fade into outro
    const transitionTypes = ['fade'];
    if (transitions) {
      transitions.forEach((t) => transitionTypes.push(t.type || 'fade'));
    }
    transitionTypes.push('fade'); // last segment → outro always fades

    // Compute segment-only durations for caption timing
    let runningSegTime = 0;
    const segmentsWithTime = segments.map((seg, i) => {
      const startTime = runningSegTime;
      runningSegTime += seg.duration - (i < segments.length - 1 ? td : 0);
      return { ...seg, startTime };
    });
    const segmentsTotalDuration = runningSegTime;

    // Total video = intro + segments + outro, minus crossfade overlaps
    // Crossfades: intro→seg1, seg1→seg2, seg2→seg3, seg3→outro = 4 overlaps
    // segmentsTotalDuration already subtracts 2 inter-segment overlaps
    const totalDuration = introDur + segmentsTotalDuration - td + outroDur - td;

    await concatenateWithCrossfade(allFiles, allDurations, concatFile, td, (secs) => {
      const pct = Math.min(100, Math.round((secs / totalDuration) * 100));
      send('progress', { stage: 'concat', percent: pct, message: 'Concatenating...' });
    }, transitionTypes);
    send('progress', { stage: 'concat', percent: 100, message: 'Concatenation complete' });

    // === Step 4b: AI Transition Review ===
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
              // Apply suggested transition fixes
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
                // No actionable suggestions — accept as-is
                approved = true;
                send('progress', { stage: 'review', percent: 100, message: `AI review: ${review.overallQuality} — no fixes available, proceeding` });
              }
            } else {
              // Max retries reached — proceed anyway
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

    // === Step 5: Render caption overlays ===
    send('progress', { stage: 'captions', percent: 0, message: 'Rendering TikTok-style captions...' });
    const captionAssets = await renderAllCaptions(captionsDir, segmentsWithTime, outW, outH);
    send('progress', { stage: 'captions', percent: 100, message: 'Captions rendered' });

    // === Step 6: Overlay captions + mix continuous audio from artist clip ===
    send('progress', { stage: 'composite', percent: 0, message: 'Compositing final video with audio...' });
    const finalOutput = path.join(jobDir, 'final_music_video.mp4');

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
      }
    );

    job.outputPath = finalOutput;
    job.totalDuration = totalDuration;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    send('complete', { downloadUrl: `/api/music-video/download/${jobId}` });
    res.end();
  } catch (err) {
    console.error('Music video render error:', err);
    send('error', { message: err.message });
    res.end();
  }
});

/**
 * GET /api/music-video/download/:jobId
 */
router.get('/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const jobDir = path.join(__dirname, '../../temp', jobId);
  const jobFile = path.join(jobDir, 'job.json');

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Rendered video not found' });
  }

  const filename = job.artistName
    ? `${job.artistName.replace(/[^a-zA-Z0-9]/g, '_')}_music_video.mp4`
    : 'music_video.mp4';
  res.download(job.outputPath, filename);
});

module.exports = router;
