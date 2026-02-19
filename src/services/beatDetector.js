const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Detect beats in an audio file using FFmpeg RMS level analysis.
 *
 * Runs FFmpeg astats to dump per-frame RMS levels, then finds peaks
 * that represent beat onsets.
 *
 * @param {string} audioFile - Path to audio file (m4a, mp3, wav, etc.)
 * @param {number} duration - Duration to analyze in seconds
 * @returns {number[]} Array of beat timestamps in seconds
 */
async function detectBeats(audioFile, duration) {
  const tmpFile = path.join(os.tmpdir(), `rms_${Date.now()}.txt`);

  await new Promise((resolve, reject) => {
    const args = [
      '-i', audioFile,
      '-af', `astats=metadata=1:length=0.02,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${tmpFile}`,
      '-f', 'null', '-',
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg astats exited with code ${code}`));
    });
    proc.on('error', reject);
  });

  // Parse the RMS output file
  // Format: frame:N pts:N pts_time:T
  //         lavfi.astats.Overall.RMS_level=-XX.XX
  const raw = fs.readFileSync(tmpFile, 'utf-8');
  fs.unlinkSync(tmpFile);

  const samples = [];
  const lines = raw.split('\n');
  let currentTime = null;

  for (const line of lines) {
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (timeMatch) {
      currentTime = parseFloat(timeMatch[1]);
    }
    const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=([-0-9.]+)/);
    if (rmsMatch && currentTime !== null) {
      const rms = parseFloat(rmsMatch[1]);
      if (isFinite(rms) && rms > -100) {
        samples.push({ time: currentTime, rms });
      }
      currentTime = null;
    }
  }

  if (samples.length < 10) return [];

  // Convert dB RMS to linear, find peaks
  const linear = samples.map((s) => ({
    time: s.time,
    level: Math.pow(10, s.rms / 20),
  }));

  // Compute moving average (window = ~0.2s worth of samples)
  const windowSize = Math.max(5, Math.round(0.2 / 0.02));
  const smoothed = [];
  for (let i = 0; i < linear.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(linear.length - 1, i + windowSize); j++) {
      sum += linear[j].level;
      count++;
    }
    smoothed.push({ time: linear[i].time, level: linear[i].level, avg: sum / count });
  }

  // Find peaks: local maxima that are significantly above the moving average
  const beats = [];
  const minGap = 0.25; // minimum 250ms between beats

  for (let i = 2; i < smoothed.length - 2; i++) {
    const s = smoothed[i];
    if (
      s.level > smoothed[i - 1].level &&
      s.level > smoothed[i - 2].level &&
      s.level > smoothed[i + 1].level &&
      s.level > smoothed[i + 2].level &&
      s.level > s.avg * 1.3 &&
      s.time <= duration
    ) {
      if (beats.length === 0 || s.time - beats[beats.length - 1] >= minGap) {
        beats.push(s.time);
      }
    }
  }

  return beats;
}

/**
 * Binary search for the nearest beat to a target time.
 *
 * @param {number[]} beats - Sorted array of beat timestamps
 * @param {number} targetTime - Target time in seconds
 * @param {number} maxOffset - Maximum allowed shift in seconds
 * @returns {number|null} Nearest beat within range, or null
 */
function snapToNearestBeat(beats, targetTime, maxOffset = 0.5) {
  if (beats.length === 0) return null;

  let lo = 0;
  let hi = beats.length - 1;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (beats[mid] < targetTime) lo = mid + 1;
    else hi = mid;
  }

  // Check the two candidates: lo and lo-1
  let best = null;
  let bestDist = Infinity;

  for (const idx of [lo - 1, lo]) {
    if (idx >= 0 && idx < beats.length) {
      const dist = Math.abs(beats[idx] - targetTime);
      if (dist < bestDist) {
        bestDist = dist;
        best = beats[idx];
      }
    }
  }

  return bestDist <= maxOffset ? best : null;
}

/**
 * Adjust segment durations so transition boundaries land on beat onsets.
 * Uses the same xfade offset math as concatenateWithCrossfade().
 *
 * @param {number[]} beats - Sorted beat timestamps
 * @param {number[]} segmentDurations - Array of durations [intro, seg1, seg2, seg3, outro]
 * @param {number} td - Transition duration (crossfade overlap)
 * @param {number} maxShift - Maximum shift per boundary in seconds
 * @returns {number[]} Adjusted durations
 */
function snapDurationsToBeats(beats, segmentDurations, td, maxShift = 0.5) {
  if (beats.length === 0) return segmentDurations;

  const durations = [...segmentDurations];

  // For each transition boundary (between segments), try to snap to a beat
  let cumulativeTime = 0;

  for (let i = 0; i < durations.length - 1; i++) {
    cumulativeTime += durations[i];
    const offset = cumulativeTime - (i + 1) * td;
    const midpoint = offset + td / 2;

    const snapped = snapToNearestBeat(beats, midpoint, maxShift);
    if (snapped !== null) {
      const shift = snapped - midpoint;
      // Apply half the shift to the current segment and half to the next
      durations[i] += shift / 2;
      durations[i + 1] -= shift / 2;

      // Clamp to reasonable bounds (min 2s per segment)
      durations[i] = Math.max(2, durations[i]);
      durations[i + 1] = Math.max(2, durations[i + 1]);
    }
  }

  return durations;
}

module.exports = { detectBeats, snapToNearestBeat, snapDurationsToBeats };
