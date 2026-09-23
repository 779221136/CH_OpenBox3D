// 地面场景：Poly Haven CC0 实拍 PBR 材质（diff + nor_gl + arm 三件套，public/textures/）
// arm 打包图：R=AO、G=Roughness、B=Metalness——roughnessMap 读 G 通道，直接用
import * as THREE from 'three';
import { asset } from '../asset.js';

export const STAGES = [
  { id: 'none', name: '无地面（纯色背景）' },
  { id: 'wood_table_001', name: '深色实木桌', tileMm: 600, source: 'https://polyhaven.com/a/wood_table_001' },
  { id: 'checkered_pavement_tiles', name: '棋盘格砖石', tileMm: 1800, source: 'https://polyhaven.com/a/checkered_pavement_tiles' },
  { id: 'beige_wall_001', name: '米色肌理墙', tileMm: 1200, source: 'https://polyhaven.com/a/beige_wall_001' },
  { id: 'crepe_satin', name: '杏色绉缎', tileMm: 800, source: 'https://polyhaven.com/a/crepe_satin' },
  { id: 'painted_plaster_wall', name: '涂装石膏墙', tileMm: 1500, source: 'https://polyhaven.com/a/painted_plaster_wall' },
  { id: 'climbing_wall_base', name: '岩板肌理', tileMm: 1500, source: 'https://polyhaven.com/a/climbing_wall_base' },
  { id: 'stretch_poplin', name: '青绿府绸', tileMm: 800, source: 'https://polyhaven.com/a/stretch_poplin' }
];

// 旧程序化地面 id → 新材质映射（旧存档/URL/预设兼容）
const LEGACY = { wood: 'wood_table_001', oak: 'wood_table_001', kraft: 'beige_wall_001', slate: 'checkered_pavement_tiles' };
export const stageId = id => STAGES.some(s => s.id === id) ? id : (LEGACY[id] || 'none');
export const stagePreset = id => STAGES.find(s => s.id === stageId(id)) || STAGES[0];

// 生成地面 mesh（半径 R mm）；none 返回 null。贴图异步加载，就绪前是中性灰；
// 返回对象带 dispose()——加载未完成就销毁会置标志，迟到的贴图直接释放不上屏。
export function makeStageGround(id, renderer) {
  const spec = stagePreset(id);
  if (!spec || spec.id === 'none') return null;
  const R = 3200, repeat = (R * 2) / spec.tileMm;
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.85, metalness: 0 });
  const geo = new THREE.CircleGeometry(R, 72);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.6; // 阴影承接网（ShadowMaterial）在 y=0，避免 z-fight
  mesh.receiveShadow = false; // 阴影统一由 y=0 的透明承影网合成，避免实体地面再接收一次形成过黑双影
  const loader = new THREE.TextureLoader(), texs = [];
  let disposed = false, pending = 3, settleReady;
  mesh.userData.ready = new Promise(resolve => { settleReady = resolve; });
  const mk = (file, srgb) => {
    const t = loader.load(asset('/textures/' + file), () => {
      if (disposed) { t.dispose(); settleReady(false); return; }
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (--pending === 0) { mat.map = texs[0]; mat.roughnessMap = texs[2]; mat.normalMap = texs[1]; mat.roughness = 1; mat.color.set(0xffffff); mat.needsUpdate = true; settleReady(true); }
    }, undefined, () => settleReady(false));
    texs.push(t);
    return t;
  };
  mk(spec.id + '_diff_1k.jpg', true);
  mk(spec.id + '_nor_gl_1k.jpg', false);
  mk(spec.id + '_arm_1k.jpg', false);
  mesh.userData.dispose = () => { disposed = true; settleReady(false); geo.dispose(); mat.dispose(); texs.forEach(t => t.dispose()); };
  return mesh;
}
