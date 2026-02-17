const ffmpeg = require('fluent-ffmpeg');

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      if (!videoStream) return reject(new Error('No video stream found'));

      resolve({
        duration: parseFloat(metadata.format.duration),
        width: videoStream.width,
        height: videoStream.height,
        fps: eval(videoStream.r_frame_rate),
        codec: videoStream.codec_name,
        hasAudio: !!audioStream,
        fileSize: parseInt(metadata.format.size, 10),
        bitRate: parseInt(metadata.format.bit_rate, 10),
      });
    });
  });
}

module.exports = { probeVideo };
