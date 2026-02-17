const express = require('express');
const path = require('path');
const fs = require('fs');
const { extractKeyFrames } = require('../services/frameExtractor');
const { analyzeFrames } = require('../services/claudeVision');
const { generateTimeline } = require('../services/timelineGenerator');

const router = express.Router();

router.post('/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const jobDir = path.join(__dirname, '../../temp', jobId);
    const jobFile = path.join(jobDir, 'job.json');

    if (!fs.existsSync(jobFile)) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));

    // Extract key frames
    const framesDir = path.join(jobDir, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });
    const frames = await extractKeyFrames(
      job.videoPath,
      framesDir,
      job.videoInfo.duration
    );

    // Send to Claude Vision
    const analysis = await analyzeFrames(frames);

    // Generate timeline
    const timeline = generateTimeline(analysis, job.videoInfo.duration);

    // Save analysis + timeline
    job.analysis = analysis;
    job.timeline = timeline;
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

    res.json({ analysis, timeline });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
