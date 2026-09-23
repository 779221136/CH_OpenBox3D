import assert from 'node:assert/strict';
import { matchSheetMask } from '../src/design/sheetFit.js';

const mask = rows => ({ width: rows[0].length, height: rows.length, alpha: Uint8Array.from(rows.join(''), c => c === '#' ? 255 : 0) });
const turn = src => {
  const out = { width: src.height, height: src.width, alpha: new Uint8Array(src.alpha.length) };
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) out.alpha[x * out.width + src.height - 1 - y] = src.alpha[y * src.width + x];
  return out;
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const target = mask(['##......', '###.....', '########', '.######.', '..#####.', '...###..']);
const sbb = [13, -7, 93, 53];
let source = target;
for (let turns = 0; turns < 4; turns++) {
  const fit = matchSheetMask(source, target, sbb);
  assert.equal(fit.rot, (360 - turns * 90) % 360, 'Asymmetric silhouette must determine all four cardinal orientations.');
  near(fit.x + fit.w / 2, 53); near(fit.y + fit.h / 2, 23);
  near(fit.rot % 180 ? fit.h : fit.w, 80); near(fit.rot % 180 ? fit.w : fit.h, 60);
  source = turn(source);
}
const padded = { width: 12, height: 11, alpha: new Uint8Array(132) };
for (let y = 0; y < target.height; y++) for (let x = 0; x < target.width; x++) padded.alpha[(y + 3) * padded.width + x + 2] = target.alpha[y * target.width + x];
const padFit = matchSheetMask(padded, target, sbb);
assert.equal(padFit.rot, 0);
[2 / 12, 3 / 11, 8 / 12, 6 / 11].forEach((v, i) => near(padFit.crop[i], v));
near(padFit.w, 80); near(padFit.h, 60);
// An existing crop must not regain excluded image pixels, even if they are opaque.
padded.alpha[0] = 255;
assert.deepEqual(matchSheetMask(padded, target, sbb, [1 / 12, 2 / 11, 10 / 12, 8 / 11]), padFit);
const rectangle = mask(['####', '####']);
const portrait = mask(['##', '##', '##', '##']);
const opaqueFit = matchSheetMask(rectangle, portrait, [0, 0, 20, 40]);
assert.deepEqual(opaqueFit, { x: -10, y: 10, w: 40, h: 20, rot: 90, crop: [0, 0, 1, 1] });
assert.equal(matchSheetMask(rectangle, mask(['##', '##']), [0, 0, 40, 40]).rot, 0, 'Equal opaque fits must retain the original orientation.');
assert.throws(() => matchSheetMask(mask(['..']), target, sbb), /完全透明/);
assert.throws(() => matchSheetMask(target, mask(['..']), sbb), /闭合轮廓/);
assert.throws(() => matchSheetMask(target, target, [0, 0, 0, 4]), /尺寸无效/);
assert.throws(() => matchSheetMask({ width: 1, height: 2, alpha: [] }, target, sbb), /尺寸无效/);
assert.throws(() => matchSheetMask(target, target, sbb, [0, 0, 2, 1]), /裁剪范围无效/);
assert.throws(() => matchSheetMask({ ...target, imageWidth: Infinity }, target, sbb), /尺寸无效/);
console.log('Sheet image fit checks passed: four orientations, alpha trim, crop preservation, opaque fallback, invalid inputs.');
