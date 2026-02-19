const { spawn } = require('child_process');
const path = require('path');

const YTDLP_PATH = '/opt/anaconda3/bin/yt-dlp';

/**
 * Validate that a string is a YouTube URL.
 * Matches youtube.com/watch?v=, youtu.be/, youtube.com/shorts/
 */
function validateYouTubeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const pattern = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)/;
  return pattern.test(url);
}

/**
 * Download a YouTube video via yt-dlp.
 *
 * @param {string} url - YouTube URL
 * @param {string} outputDir - Directory to save the downloaded file
 * @param {object} options
 * @param {string} options.clipType - 'artist' or 'guitar' (used for filename)
 * @param {function} [options.onProgress] - Called with { percent } during download
 * @returns {Promise<{ filePath: string, title: string }>}
 */
function downloadYouTube(url, outputDir, options = {}) {
  const clipType = options.clipType || 'clip';
  const outputPath = path.join(outputDir, `yt_${clipType}.mp4`);

  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--newline',
      '--print', 'title',
      '-o', outputPath,
      url,
    ];

    const proc = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let title = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;

      // yt-dlp with --print title outputs the title as the first line
      // Then with --newline, progress lines look like: [download]  XX.X% of ...
      const lines = text.split('\n');
      for (const line of lines) {
        const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);
        if (progressMatch && options.onProgress) {
          options.onProgress({ percent: parseFloat(progressMatch[1]) });
        }
        // First non-progress, non-empty line is the title from --print
        if (!title && line.trim() && !line.startsWith('[')) {
          title = line.trim();
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ filePath: outputPath, title: title || 'Unknown' });
      } else {
        const errLines = stderr.trim().split('\n').slice(-5).join('\n');
        reject(new Error(`yt-dlp exited with code ${code}: ${errLines}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Trim a video clip using FFmpeg stream copy (no re-encode).
 * If no startTime and no endTime, returns inputPath unchanged.
 *
 * @param {string} inputPath - Source video file
 * @param {string} outputPath - Trimmed output file
 * @param {number|null} startTime - Start time in seconds (null = beginning)
 * @param {number|null} endTime - End time in seconds (null = to the end)
 * @returns {Promise<string>} - Path to the trimmed (or original) file
 */
function trimClip(inputPath, outputPath, startTime, endTime) {
  if (startTime == null && endTime == null) {
    return Promise.resolve(inputPath);
  }

  return new Promise((resolve, reject) => {
    const args = ['-y'];

    if (startTime != null) {
      args.push('-ss', String(startTime));
    }

    args.push('-i', inputPath);

    if (startTime != null && endTime != null) {
      args.push('-t', String(endTime - startTime));
    } else if (endTime != null) {
      args.push('-t', String(endTime));
    }

    args.push('-c', 'copy', outputPath);

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        const lines = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new Error(`ffmpeg trim exited with code ${code}: ${lines}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

module.exports = { validateYouTubeUrl, downloadYouTube, trimClip };
