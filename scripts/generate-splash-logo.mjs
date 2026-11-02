// Builds assets/images/splash-logo.png from the app logo.
// Android 12+ crops the splash icon with a circular mask. The source logo fills its square and has white corners, so it
// came out cut, and the corners would show on the dark splash. This gives it transparent rounded corners and clear space.
//   node scripts/generate-splash-logo.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Jimp = require('jimp-compact');

const CANVAS = 1024;
const LOGO = 600; // Leaves the whole logo inside the circular mask.

// Bounds of the blue rounded square inside the 1254px source, measured from the image.
const SOURCE = { left: 30, top: 22, right: 1229, bottom: 1231, radius: 265 };

const logo = await Jimp.read(new URL('../assets/images/cd4_logo.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
logo.crop(SOURCE.left, SOURCE.top, SOURCE.right - SOURCE.left, SOURCE.bottom - SOURCE.top);
const scale = LOGO / logo.bitmap.width;
logo.resize(LOGO, LOGO, Jimp.RESIZE_BICUBIC);

// Signed distance to the rounded square gives a smooth one-pixel edge.
const radius = SOURCE.radius * scale;
logo.scan(0, 0, LOGO, LOGO, function (x, y, idx) {
  const dx = Math.abs(x + 0.5 - LOGO / 2) - (LOGO / 2 - radius);
  const dy = Math.abs(y + 0.5 - LOGO / 2) - (LOGO / 2 - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
  this.bitmap.data[idx + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - outside)));
});

const canvas = await new Promise((resolve, reject) => {
  new Jimp(CANVAS, CANVAS, 0x00000000, (error, image) => (error ? reject(error) : resolve(image)));
});
canvas.composite(logo, (CANVAS - LOGO) / 2, (CANVAS - LOGO) / 2);
await canvas.writeAsync(new URL('../assets/images/splash-logo.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
console.log('wrote assets/images/splash-logo.png');
