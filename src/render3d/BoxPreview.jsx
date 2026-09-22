// 正式 3D 与实验室共享的预览输入：只汇总当前 store，不建立第二套几何或烘焙权威。
import React from 'react';
import { geomOf } from '../dieline/geom.js';
import { BoxCanvas } from './BoxCanvas.jsx';

export function boxPreviewContextOf(s, m) {
  const g = geomOf(s, m.t);
  const bakeKey = JSON.stringify({
    layers: s.layers.map(l => ({ k: l.kind, pid: l.panelId, x: l.x, y: l.y, w: l.w, h: l.h, c: l.content, f: l.font, s: l.size, sx: l.scaleX, sy: l.scaleY, wt: l.weight, col: l.color, fin: l.finish, edir: l.embDir, r: l.rot, o: l.opacity, v: l.visible, cw: l.crop, px: l.pxw, im: l.imgSrc ? l.imgSrc.length : 0 })),
    panels: g.panels.map(p => [p.panelId, p.pts]),
    paper: s.paper3d, grain: [s.grainStrength, s.grainScale], fx: s.fx, glossR: s.glossRoughness3d, ed: s.embDepth, es: s.embSharpness3d, edir: s.embDir, eb: s.embBoost, bleed: s.bleed,
    fc: s.foilColor3d, sc: s.silverColor3d, hc: s.holoColor3d, rbw: s.holoRainbow3d, pt: s.paperTint3d // 箔色/镭射底色/彩虹底纹/纸张底色进烘焙（albedo 染色）；iridescence/跨度只进材质，不进 bakeKey
  });
  return { g, bakeKey, sbbKey: g.sbb.join(',') };
}

export function BoxPreview({ s, m, context, engineRef, fitFold = false, shadowSamples = 5, lightEdit = '0', selLight = '', onLightSelect, onLightEdit }) {
  const ctx = context || boxPreviewContextOf(s, m);
  return <BoxCanvas
    l={s.L} w={s.W} h={s.H} t={m.t} tpl={s.tpl} custom={s.custom} fold={s.fold} paper={s.paper3d} film={s.film3d} glue={s.glue} paperTint={s.paperTint3d}
    layers={s.layers} panels={ctx.g.panels} sbb={ctx.g.sbb} bleed={s.bleed} sbbKey={ctx.sbbKey} bakeKey={ctx.bakeKey}
    foilOn={s.fx.foil ? '1' : '0'} suvOn={s.fx.suv ? '1' : '0'} glossOn={s.fx.gloss !== false ? '1' : '0'} embOn={s.fx.emb ? '1' : '0'} holoOn={s.fx.holo !== false ? '1' : '0'}
    spin={s.spin ? '1' : '0'} check={s.check}
    studio={s.studio3d} environment={s.environment3d} stage={s.stage3d} exposure={s.expo3d}
    environmentIntensity={s.envIntensity3d} environmentRotation={s.envRotation3d}
    backgroundShown={s.showEnvironmentBackground ? '1' : '0'} backgroundMode={s.backgroundMode3d} backgroundColor={s.backgroundColor3d} backgroundBlur={s.backgroundBlur3d}
    domeSpec={s.domeSpec3d} cameraType={s.cameraProjection3d} fov={s.fov3d}
    lightsSpec={s.lightsSpec3d}
    shadowSoftness={s.shadowSoftness3d} shadowOpacity={s.shadowOpacity3d}
    surfaceRoughness={s.surfaceRoughness} grainStrength={s.grainStrength} grainScale={s.grainScale}
    filmClearcoat={s.filmClearcoat3d} filmClearcoatRoughness={s.filmClearcoatRoughness3d} filmRoughnessFactor={s.filmRoughnessFactor3d} filmSheen={s.filmSheen3d}
    foilMetalness={s.foilMetalness3d} foilRoughness={s.foilRoughness3d} foilColor={s.foilColor3d} silverColor={s.silverColor3d} holoColor={s.holoColor3d} iridescence={s.iridescence3d} holoSpan={s.holoSpan3d} holoRainbow={s.holoRainbow3d}
    uvClearcoat={s.uvClearcoat3d} uvRoughness={s.uvRoughness3d} glossRoughness={s.glossRoughness3d}
    embNormalStrength={s.embNormalStrength3d} embDisplacementStrength={s.embDisplacementStrength3d}
    toneMapping={s.toneMapping3d}
    shadowSamples={shadowSamples}
    lightEdit={lightEdit} selLight={selLight} onLightSelect={onLightSelect} onLightEdit={onLightEdit}
    fitFold={fitFold ? '1' : '0'}
    embDepth={'' + s.embDepth} embSharpness={s.embSharpness3d} embDir={s.embDir} embBoost={s.embBoost ? '1' : '0'}
    engineRef={engineRef} />;
}
