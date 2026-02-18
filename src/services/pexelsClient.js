const https = require('https');
const fs = require('fs');
const path = require('path');
const brand = require('../config/brand');

const API_KEY = process.env.PEXELS_API_KEY;
const BASE_URL = 'https://api.pexels.com/videos/search';

/**
 * Search Pexels for videos matching a query.
 * Returns array of video results with download URLs.
 */
function searchVideos(query, options = {}) {
  const params = new URLSearchParams({
    query: query || brand.musicVideo.pexelsDefaultQuery,
    per_page: String(options.perPage || 3),
    orientation: options.orientation || 'portrait',
  });

  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error('PEXELS_API_KEY not set in .env'));
    }

    const url = `${BASE_URL}?${params}`;
    const req = https.get(url, {
      headers: { Authorization: API_KEY },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Pexels API error ${res.statusCode}: ${body}`));
        }
        try {
          const data = JSON.parse(body);
          const videos = (data.videos || []).map((v) => ({
            id: v.id,
            url: v.url,
            duration: v.duration,
            image: v.image,
            // Pick the best HD file (prefer portrait, then largest)
            videoFile: pickBestFile(v.video_files),
          }));
          resolve(videos);
        } catch (err) {
          reject(new Error('Failed to parse Pexels response'));
        }
      });
    });
    req.on('error', reject);
  });
}

/**
 * Pick the best video file from Pexels options.
 * Prefers HD quality, portrait-friendly dimensions.
 */
function pickBestFile(files) {
  if (!files || files.length === 0) return null;

  // Sort by height descending (prefer taller/portrait), then by width
  const sorted = [...files]
    .filter((f) => f.quality === 'hd' || f.quality === 'sd')
    .sort((a, b) => {
      // Prefer HD
      if (a.quality === 'hd' && b.quality !== 'hd') return -1;
      if (b.quality === 'hd' && a.quality !== 'hd') return 1;
      // Then prefer taller (portrait)
      return (b.height || 0) - (a.height || 0);
    });

  return sorted[0] || files[0];
}

/**
 * Download a video file from URL to a local path.
 */
function downloadVideo(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);

    function doGet(url) {
      https.get(url, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(outputPath);
          const newFile = fs.createWriteStream(outputPath);
          return doGetWithStream(res.headers.location, newFile);
        }

        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(outputPath);
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    }

    function doGetWithStream(url, stream) {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          stream.close();
          fs.unlinkSync(outputPath);
          const newStream = fs.createWriteStream(outputPath);
          return doGetWithStream(res.headers.location, newStream);
        }

        if (res.statusCode !== 200) {
          stream.close();
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }

        res.pipe(stream);
        stream.on('finish', () => {
          stream.close();
          resolve(outputPath);
        });
      }).on('error', (err) => {
        stream.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    }

    doGet(videoUrl);
  });
}

/**
 * Search Pexels and download the best matching crowd/audience clip.
 * Returns { filePath, thumbnail, pexelsUrl, duration } or null.
 */
async function fetchCrowdClip(jobDir, query) {
  const videos = await searchVideos(query || brand.musicVideo.pexelsDefaultQuery);

  if (!videos.length || !videos[0].videoFile) {
    return null;
  }

  const best = videos[0];
  const ext = '.mp4';
  const outputPath = path.join(jobDir, `pexels_crowd${ext}`);

  await downloadVideo(best.videoFile.link, outputPath);

  return {
    filePath: outputPath,
    thumbnail: best.image,
    pexelsUrl: best.url,
    duration: best.duration,
  };
}

module.exports = { searchVideos, downloadVideo, fetchCrowdClip };
