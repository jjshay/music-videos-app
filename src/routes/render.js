const express = require('express');
const path = require('path');
const fs = require('fs');
const { renderAllOverlays } = require('../services/overlayRenderer');
const { buildIntro, compositeOverlays } = require('../services/videoCompositor');
const { recordEdits } = require('../services/editHistory');
const brand = require('../config/brand');

const router = express.Router();

const DEFAULT_MUSIC = path.join(__dirname, '../../music/upbeat-art-drums.mp3');

router.post('/:jobId', async (req, res) => {
  // SSE headers for progress streaming
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

    if (!job.timeline) {
      send('error', { message: 'Run analysis first' });
      return res.end();
    }

    // Save original timeline for edit tracking
    const originalTimeline = JSON.parse(JSON.stringify(job.timeline));

    // Accept updated timeline/callouts from request body if provided
    if (req.body && req.body.timeline) {
      job.timeline = req.body.timeline;
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
    }

    // Record any edits the user made (original vs final) for future style learning
    recordEdits(originalTimeline, job.timeline);

    // Determine music file
    let musicPath = DEFAULT_MUSIC;
    const customMusic = path.join(jobDir, 'custom_music.mp3');
    if (fs.existsSync(customMusic)) {
      musicPath = customMusic;
    }

    // Check that music file exists
    if (!fs.existsSync(musicPath)) {
      send('error', { message: 'No music file found. Upload a track or add upbeat-art-drums.mp3 to the music/ directory.' });
      return res.end();
    }

    const overlaysDir = path.join(jobDir, 'overlays');
    fs.mkdirSync(overlaysDir, { recursive: true });

    // Output dimensions: vertical 9:16 for mobile
    const outW = brand.output.width;
    const outH = brand.output.height;

    // Step 1: Render overlay PNGs at output resolution
    send('progress', { stage: 'overlays', percent: 0, message: 'Rendering overlay graphics...' });
    const overlayAssets = await renderAllOverlays(
      overlaysDir,
      job.timeline,
      outW,
      outH
    );
    send('progress', { stage: 'overlays', percent: 100, message: 'Overlays rendered' });

    // Step 2: Build intro with xfade
    send('progress', { stage: 'intro', percent: 0, message: 'Building intro sequence...' });
    const introVideo = path.join(jobDir, 'temp_intro.mp4');
    await buildIntro(
      overlayAssets.intro,
      job.videoPath,
      introVideo,
      Math.round(job.videoInfo.fps),
      job.videoInfo,
      (stage, pct) => send('progress', { stage: 'intro', percent: Math.round(pct), message: 'Building intro...' })
    );
    send('progress', { stage: 'intro', percent: 100, message: 'Intro complete' });

    // Step 3: Composite callouts + watermark + music
    send('progress', { stage: 'composite', percent: 0, message: 'Compositing final video...' });
    const finalOutput = path.join(jobDir, 'final.mp4');
    await compositeOverlays(
      introVideo,
      overlayAssets,
      musicPath,
      finalOutput,
      job.videoInfo,
      (stage, pct) => send('progress', { stage: 'composite', percent: Math.round(pct), message: 'Compositing...' })
    );

    // Save output path
    job.outputPath = finalOutput;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    send('complete', { downloadUrl: `/api/download/${jobId}` });
    res.end();
  } catch (err) {
    console.error('Render error:', err);
    send('error', { message: err.message });
    res.end();
  }
});


module.exports = router;
