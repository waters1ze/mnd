const ffmpeg = require('ffmpeg-static');
const { execFileSync } = require('child_process');
const { join } = require('path');
const { mkdirSync, existsSync } = require('fs');

const destDir = join(__dirname, 'fixtures');
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}
const destFile = join(destDir, 'reference_video.mp4');

console.log('Generating test video...');
execFileSync(ffmpeg, [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc=duration=10:size=640x360:rate=25',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=10',
  '-c:v', 'libx264',
  '-c:a', 'aac',
  '-pix_fmt', 'yuv420p',
  destFile
], { stdio: 'inherit' });
console.log('Done.');
