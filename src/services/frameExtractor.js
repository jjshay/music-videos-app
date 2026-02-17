const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

function extractKeyFrames(videoPath, outputDir, duration, count = 5) {
  return new Promise((resolve, reject) => {
    const interval = duration / (count + 1);
    const timestamps = [];
    for (let i = 1; i <= count; i++) {
      timestamps.push(Math.round(interval * i));
    }

    const frames = [];
    let completed = 0;

    timestamps.forEach((ts, idx) => {
      const outputFile = path.join(outputDir, `frame_${idx}.jpg`);
      frames.push(outputFile);

      ffmpeg(videoPath)
        .seekInput(ts)
        .frames(1)
        .output(outputFile)
        .outputOptions(['-q:v', '2'])
        .on('end', () => {
          completed++;
          if (completed === count) resolve(frames);
        })
        .on('error', (err) => reject(err))
        .run();
    });
  });
}

module.exports = { extractKeyFrames };
