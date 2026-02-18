require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadRoute = require('./src/routes/upload');
const analyzeRoute = require('./src/routes/analyze');
const renderRoute = require('./src/routes/render');
const musicVideoRoute = require('./src/routes/music-video');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/upload', uploadRoute);
app.use('/api/analyze', analyzeRoute);
app.use('/api/render', renderRoute);
app.use('/api/music-video', musicVideoRoute);

// Download route
app.get('/api/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const jobDir = path.join(__dirname, 'temp', jobId);
  const jobFile = path.join(jobDir, 'job.json');

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
  if (!job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Rendered video not found' });
  }

  const baseName = path.parse(job.originalName).name;
  res.download(job.outputPath, `${baseName}_gauntlet.mp4`);
});

// Music upload endpoint
const musicUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const jobDir = path.join(__dirname, 'temp', req.params.jobId);
      cb(null, jobDir);
    },
    filename: (req, file, cb) => cb(null, 'custom_music.mp3'),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post('/api/music/:jobId', musicUpload.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No music file' });
  res.json({ message: 'Music uploaded', filename: req.file.originalname });
});

// Update timeline endpoint
app.put('/api/timeline/:jobId', (req, res) => {
  const { jobId } = req.params;
  const jobFile = path.join(__dirname, 'temp', jobId, 'job.json');

  if (!fs.existsSync(jobFile)) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
  job.timeline = req.body.timeline;
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  res.json({ message: 'Timeline updated', timeline: job.timeline });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Gauntlet Gallery Video Overlay Tool`);
  console.log(`Running at http://localhost:${PORT}`);
  console.log(`FFmpeg required: ensure ffmpeg and ffprobe are in PATH`);
});
