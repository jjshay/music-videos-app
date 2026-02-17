const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { probeVideo } = require('../services/videoProbe');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = uuidv4();
    const jobDir = path.join(__dirname, '../../temp', jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    req.jobId = jobId;
    req.jobDir = jobDir;
    cb(null, jobDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `source${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mov', '.mp4', '.m4v', '.avi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported format: ${ext}. Use MOV, MP4, M4V, or AVI.`));
    }
  },
});

router.post('/', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoPath = req.file.path;
    const videoInfo = await probeVideo(videoPath);

    // Store job metadata
    const jobMeta = {
      jobId: req.jobId,
      videoPath,
      videoInfo,
      originalName: req.file.originalname,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(req.jobDir, 'job.json'),
      JSON.stringify(jobMeta, null, 2)
    );

    res.json({
      jobId: req.jobId,
      videoInfo,
      originalName: req.file.originalname,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
