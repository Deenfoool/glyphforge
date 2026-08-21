(() => {
  'use strict';

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  class RNG {
    constructor(seed = 1) { this.seed = (Number(seed) || 1) >>> 0; }
    next() {
      let t = this.seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    signed() { return this.next() * 2 - 1; }
  }

  const DEFAULTS = Object.freeze({
    mode: 'density', tip: 'circle', size: 15, hardness: 55, falloff: 'soft', customFalloff: 55,
    opacity: 100, flow: 22, spacing: 14, smoothing: 24, stabilizer: 0,
    roundness: 100, angle: 0, airbrush: false, buildUpRate: 65,
    scatterEnabled: false, scatterX: 0, scatterY: 0, count: 1, countJitter: 0,
    sizeJitter: 0, minDiameter: 20, angleJitter: 0, roundnessJitter: 0,
    glyphJitter: 0, densityJitter: 0, colorJitter: 0, glyphSequence: false, directionGlyphs: false,
    speedSize: 0, speedDensity: 0, pressureSize: false, pressureFlow: false, pressureDensity: false,
    pressureScatter: false, tiltAngle: false,
    texture: 'none', textureScale: 3, textureStrength: 55,
    dualBrush: false, dualTip: 'diamond', dualSize: 62,
    blendMode: 'add', preserveDetail: 0, edgeMode: 'none', edgeStrength: 50,
    directionalShading: false, lightAngle: 315, orientationGlyphs: false,
    snapAngle: 0, symmetry: 'none', seed: 1337,
    customTip: '...#...\n..###..\n.#####.\n#######\n.#####.\n..###..\n...#...',
    pattern: '/\\/\\\n\\/\\/', locked: {}
  });

  const PRESETS = Object.freeze({
    'Hard Pencil': { tip:'circle', size:5, hardness:100, opacity:100, flow:100, spacing:10, falloff:'hard', blendMode:'replace', mode:'normal' },
    'Soft Pencil': { tip:'circle', size:9, hardness:65, opacity:85, flow:60, spacing:10, falloff:'soft', blendMode:'replace', mode:'density' },
    'Soft Shade': { tip:'circle', size:27, hardness:18, opacity:55, flow:12, spacing:8, falloff:'gaussian', mode:'density', blendMode:'add' },
    'Deep Shadow': { tip:'circle', size:21, hardness:45, opacity:88, flow:26, spacing:10, mode:'darken', blendMode:'add' },
    'Airbrush': { tip:'circle', size:33, hardness:8, opacity:45, flow:5, spacing:5, falloff:'gaussian', airbrush:true, buildUpRate:80, mode:'density' },
    'Chalk': { tip:'ellipse', size:17, hardness:60, opacity:78, flow:45, spacing:14, roundness:46, texture:'noise', textureStrength:78, densityJitter:18, angleJitter:10 },
    'Noise': { tip:'circle', size:25, hardness:20, opacity:65, flow:35, spacing:18, scatterEnabled:true, scatterX:85, scatterY:85, count:5, countJitter:70, glyphJitter:100, densityJitter:50, texture:'noise' },
    'Spray': { tip:'circle', size:31, hardness:0, opacity:60, flow:22, spacing:9, scatterEnabled:true, scatterX:100, scatterY:100, count:7, countJitter:100, glyphJitter:80, densityJitter:45 },
    'Hair': { tip:'line', size:17, hardness:90, opacity:82, flow:64, spacing:12, roundness:18, angleJitter:8, directionGlyphs:true, orientationGlyphs:true, speedSize:55 },
    'Grass': { tip:'line', size:19, hardness:100, opacity:90, flow:75, spacing:55, scatterEnabled:true, scatterX:48, scatterY:10, count:3, sizeJitter:62, angleJitter:28, directionGlyphs:true, glyphJitter:45 },
    'Smoke': { tip:'circle', size:39, hardness:4, opacity:34, flow:8, spacing:9, scatterEnabled:true, scatterX:28, scatterY:28, count:2, sizeJitter:35, densityJitter:42, texture:'noise', textureStrength:40 },
    'Cloud': { tip:'circle', size:37, hardness:18, opacity:48, flow:14, spacing:13, scatterEnabled:true, scatterX:35, scatterY:24, count:3, sizeJitter:28, texture:'dots', textureStrength:26 },
    'Hatching': { tip:'line', size:13, hardness:100, opacity:100, flow:100, spacing:62, angle:45, texture:'hatch', textureStrength:100, directionGlyphs:true },
    'Cross Hatch': { tip:'diamond', size:17, hardness:85, opacity:100, flow:80, spacing:45, texture:'crosshatch', textureStrength:100 },
    'Pixel': { tip:'square', size:1, hardness:100, opacity:100, flow:100, spacing:100, blendMode:'replace', mode:'normal' },
    'Glitch': { tip:'square', size:23, hardness:80, opacity:75, flow:55, spacing:24, scatterEnabled:true, scatterX:100, scatterY:18, count:4, glyphJitter:100, densityJitter:70, texture:'matrix', blendMode:'difference' },
    'Terminal': { tip:'square', size:8, hardness:100, opacity:90, flow:80, spacing:24, glyphSequence:true, texture:'checker', textureStrength:25 },
    'Matrix': { tip:'line', size:25, hardness:65, opacity:85, flow:55, spacing:18, roundness:22, angle:90, glyphSequence:true, scatterEnabled:true, scatterX:20, scatterY:70, count:3, texture:'matrix' },
    'Ink': { tip:'ellipse', size:11, hardness:92, opacity:100, flow:82, spacing:7, roundness:42, speedSize:45, pressureSize:true, pressureFlow:true, tiltAngle:true, mode:'normal' },
    'Calligraphy': { tip:'ellipse', size:19, hardness:100, opacity:100, flow:100, spacing:6, roundness:24, angle:35, speedSize:20, pressureSize:true, tiltAngle:true, orientationGlyphs:true, mode:'normal' }
  });

  class BrushEngine {
    constructor(adapter) {
      this.adapter = adapter;
      this.settings = typeof structuredClone === 'function' ? structuredClone(DEFAULTS) : JSON.parse(JSON.stringify(DEFAULTS));
      this.rng = new RNG(this.settings.seed);
      this.sequenceIndex = 0;
      this.stroke = null;
      this.airbrushTimer = 0;
    }
    static get defaults() { return DEFAULTS; }
    static get presets() { return PRESETS; }
    setSettings(next) {
      this.settings = { ...this.settings, ...next, locked: { ...(this.settings.locked || {}), ...(next.locked || {}) } };
      this.rng = new RNG(this.settings.seed);
    }
    applyPreset(name) {
      const preset = PRESETS[name]; if (!preset) return;
      const locked = this.settings.locked || {}, patch = {};
      Object.entries(preset).forEach(([key, value]) => { if (!locked[key]) patch[key] = value; });
      this.setSettings(patch);
    }
    begin(point, input = {}) {
      this.rng = new RNG(this.settings.seed + Date.now() % 1000000); this.sequenceIndex = 0;
      this.stroke = { start:{...point}, lastRaw:{...point}, lastSmooth:{...point}, lastStamp:null, lastTime:performance.now(), direction:{x:1,y:0}, speed:0, input };
      this._stampSymmetry(point, input, true); this.stroke.lastStamp = {...point}; this._startAirbrush();
    }
    move(point, input = {}) {
      if (!this.stroke) return;
      const now = performance.now(), dt = Math.max(1, now - this.stroke.lastTime);
      const rawDx = point.x - this.stroke.lastRaw.x, rawDy = point.y - this.stroke.lastRaw.y, rawDist = Math.hypot(rawDx, rawDy);
      this.stroke.speed = lerp(this.stroke.speed, rawDist / dt, .35);
      if (rawDist > .0001) this.stroke.direction = {x:rawDx/rawDist,y:rawDy/rawDist};
      const smooth = clamp(this.settings.smoothing/100), stabilizer = clamp(this.settings.stabilizer/100);
      const alpha = Math.max(.05, 1 - smooth*.78 - stabilizer*.17);
      let target = {x:lerp(this.stroke.lastSmooth.x, point.x, alpha), y:lerp(this.stroke.lastSmooth.y, point.y, alpha)};
      if (this.settings.snapAngle > 0) target = this._snapPoint(target);
      const last = this.stroke.lastStamp || this.stroke.lastSmooth, dx = target.x-last.x, dy=target.y-last.y, distance=Math.hypot(dx,dy);
      const spacingCells = Math.max(.2, this._dynamicSize(input) * Math.max(1,this.settings.spacing)/100);
      if (distance >= spacingCells) {
        const steps=Math.floor(distance/spacingCells);
        for(let i=1;i<=steps;i++){const t=(i*spacingCells)/distance,p={x:last.x+dx*t,y:last.y+dy*t};this._stampSymmetry(p,input,false);this.stroke.lastStamp=p;}
      }
      this.stroke.lastRaw={...point}; this.stroke.lastSmooth=target; this.stroke.lastTime=now; this.stroke.input=input;
    }
    end(point,input={}) { if(!this.stroke)return; if(point)this.move(point,input); this._stopAirbrush(); this.stroke=null; }
    cancel(){this._stopAirbrush();this.stroke=null;}
    stamp(point,input={}){this._stampSymmetry(point,input,true);}
    _startAirbrush(){
      this._stopAirbrush(); if(!this.settings.airbrush)return;
      const rate=Math.max(15,140-this.settings.buildUpRate);
      this.airbrushTimer=window.setInterval(()=>{if(!this.stroke?.lastSmooth)return;this._stampSymmetry(this.stroke.lastSmooth,this.stroke.input||{},false,.35);this.adapter.requestRender?.();},rate);
    }
    _stopAirbrush(){if(this.airbrushTimer)clearInterval(this.airbrushTimer);this.airbrushTimer=0;}
    _snapPoint(point){
      const stepDeg=Number(this.settings.snapAngle)||0;if(!stepDeg||!this.stroke)return point;
      const s=this.stroke.start,dx=point.x-s.x,dy=point.y-s.y,dist=Math.hypot(dx,dy);if(!dist)return point;
      const step=stepDeg*Math.PI/180,a=Math.round(Math.atan2(dy,dx)/step)*step;
      return{x:s.x+Math.cos(a)*dist,y:s.y+Math.sin(a)*dist};
    }
    _symmetryPoints(point){
      const {cols,rows}=this.adapter.getDimensions(),cx=(cols-1)/2,cy=(rows-1)/2,mode=this.settings.symmetry,pts=[{...point}];
      const add=p=>{if(!pts.some(q=>Math.abs(q.x-p.x)<.001&&Math.abs(q.y-p.y)<.001))pts.push(p)};
      if(mode==='mirrorX'||mode==='mirrorXY')add({x:2*cx-point.x,y:point.y});
      if(mode==='mirrorY'||mode==='mirrorXY')add({x:point.x,y:2*cy-point.y});
      if(mode==='mirrorXY')add({x:2*cx-point.x,y:2*cy-point.y});
      const radial=mode==='radial4'?4:mode==='radial8'?8:0;
      if(radial){const dx=point.x-cx,dy=point.y-cy;for(let i=1;i<radial;i++){const a=i*Math.PI*2/radial;add({x:cx+dx*Math.cos(a)-dy*Math.sin(a),y:cy+dx*Math.sin(a)+dy*Math.cos(a)})}}
      return pts;
    }
    _stampSymmetry(point,input,initial,flowScale=1){this._symmetryPoints(point).forEach(p=>this._stamp(p,input,initial,flowScale));}
    _dynamicSize(input){
      let size=Math.max(1,Number(this.settings.size)||1);const jitter=clamp(this.settings.sizeJitter/100),min=clamp(this.settings.minDiameter/100);
      if(jitter>0)size*=lerp(1,Math.max(min,this.rng.next()),jitter);
      const speed=clamp((this.stroke?.speed||0)/.035);if(this.settings.speedSize)size*=lerp(1,1-speed*.72,this.settings.speedSize/100);
      if(this.settings.pressureSize&&Number.isFinite(input.pressure)&&input.pressure>0)size*=lerp(.15,1,input.pressure);
      return Math.max(1,size);
    }
    _dynamicAngle(input){let angle=Number(this.settings.angle)||0;if(this.settings.angleJitter)angle+=this.rng.signed()*180*this.settings.angleJitter/100;if(this.settings.tiltAngle&&(input.tiltX||input.tiltY))angle+=Math.atan2(input.tiltY||0,input.tiltX||1)*180/Math.PI;return angle;}
    _dynamicRoundness(){let r=clamp((Number(this.settings.roundness)||100)/100,.05,1);if(this.settings.roundnessJitter)r*=lerp(1,Math.max(.08,this.rng.next()),this.settings.roundnessJitter/100);return clamp(r,.05,1);}
    _stamp(center,input,initial,flowScale){
      const size=this._dynamicSize(input),angle=this._dynamicAngle(input),roundness=this._dynamicRoundness();
      const countBase=Math.max(1,Math.round(this.settings.count||1)),count=Math.max(1,Math.round(countBase*lerp(1,this.rng.next(),this.settings.countJitter/100)));
      for(let n=0;n<count;n++){
        const pm=this.settings.pressureScatter&&input.pressure>0?input.pressure:1;
        const sx=this.settings.scatterEnabled?this.rng.signed()*size*this.settings.scatterX/100*pm:0;
        const sy=this.settings.scatterEnabled?this.rng.signed()*size*this.settings.scatterY/100*pm:0;
        this._rasterStamp({x:center.x+sx,y:center.y+sy},size,angle,roundness,input,flowScale);
      }
    }
    _rasterStamp(center,size,angleDeg,roundness,input,flowScale){
      const radius=Math.max(.5,size/2),bounds=Math.ceil(radius*1.5+2),minX=Math.floor(center.x-bounds),maxX=Math.ceil(center.x+bounds),minY=Math.floor(center.y-bounds),maxY=Math.ceil(center.y+bounds);
      const angle=-angleDeg*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
        if(!this.adapter.inBounds(x,y))continue;
        const dx=(x+.5-center.x)/radius,dy=(y+.5-center.y)/radius,rx=dx*cos-dy*sin,ry=(dx*sin+dy*cos)/roundness;
        let mask=this._tipMask(rx,ry,x,y);if(mask<=0)continue;mask=this._falloff(mask)*this._textureFactor(x,y,rx,ry);
        if(this.settings.dualBrush){const ds=Math.max(.1,this.settings.dualSize/100);mask*=this._tipMask(rx/ds,ry/ds,x,y,this.settings.dualTip)}
        if(mask>.0001)this._applyCell(x,y,mask,input,flowScale);
      }
    }
    _tipMask(x,y,cellX,cellY,forcedTip){
      const tip=forcedTip||this.settings.tip,ax=Math.abs(x),ay=Math.abs(y);
      if(tip==='square'){const d=Math.max(ax,ay);return d<=1?1-d:0}
      if(tip==='diamond'){const d=ax+ay;return d<=1?1-d:0}
      if(tip==='line'){const d=Math.max(ax,ay/.16);return d<=1?1-d:0}
      if(tip==='ellipse'||tip==='circle'){const d=Math.hypot(x,y);return d<=1?1-d:0}
      if(tip==='custom')return this._customTipFactor(x,y);
      if(tip==='pattern')return this._patternTipFactor(cellX,cellY);
      const d=Math.hypot(x,y);return d<=1?1-d:0;
    }
    _customTipFactor(nx,ny){
      const lines=String(this.settings.customTip||'#').replace(/\r/g,'').split('\n'),h=lines.length,w=Math.max(1,...lines.map(l=>Array.from(l).length));
      const u=clamp((nx+1)/2,0,.9999),v=clamp((ny+1)/2,0,.9999),row=lines[Math.floor(v*h)]||'',ch=Array.from(row)[Math.floor(u*w)]||' ';
      if(ch===' '||ch==='.')return ch==='.'?.18:0;if(ch===':'||ch==='-')return.35;if(ch==='+'||ch==='*')return.65;return 1;
    }
    _patternTipFactor(x,y){const lines=String(this.settings.pattern||'#').replace(/\r/g,'').split('\n'),h=lines.length,w=Math.max(1,...lines.map(l=>Array.from(l).length)),row=Array.from(lines[((y%h)+h)%h]||''),ch=row[((x%w)+w)%w]||' ';return ch===' '||ch==='.'?0:1;}
    _falloff(mask){
      if(mask<=0)return 0;const h=clamp(this.settings.hardness/100),p=this.settings.falloff;
      if(p==='hard')return 1;if(p==='linear')return Math.pow(mask,lerp(2.4,.55,h));if(p==='gaussian')return Math.pow(mask,lerp(4.5,.7,h));if(p==='custom')return Math.pow(mask,lerp(5,.35,this.settings.customFalloff/100));return Math.pow(mask,lerp(3.2,.5,h));
    }
    _textureFactor(x,y,nx,ny){
      const type=this.settings.texture;if(!type||type==='none')return 1;const scale=Math.max(1,Number(this.settings.textureScale)||1),s=clamp(this.settings.textureStrength/100);let f=1;
      if(type==='hatch')f=((x+y)%Math.round(scale*2)===0)?1:.18;
      else if(type==='crosshatch')f=(((x+y)%Math.round(scale*2)===0)||((x-y)%Math.round(scale*2)===0))?1:.12;
      else if(type==='dots')f=(x%Math.round(scale*2)===0&&y%Math.round(scale*2)===0)?1:.15;
      else if(type==='checker')f=((Math.floor(x/scale)+Math.floor(y/scale))%2===0)?1:.25;
      else if(type==='bricks')f=((y%Math.round(scale*2)===0)||((x+(Math.floor(y/(scale*2))%2)*scale)%Math.round(scale*4)===0))?1:.28;
      else if(type==='matrix')f=((x*17+y*31+this.settings.seed)%Math.max(2,Math.round(scale*3))===0)?1:.22;
      else if(type==='noise')f=.2+this.rng.next()*.8;return lerp(1,f,s);
    }
    _applyCell(x,y,mask,input,flowScale){
      const old=this.adapter.getCell(x,y);if(!old)return;const pressure=Number.isFinite(input.pressure)&&input.pressure>0?input.pressure:1;
      const fp=this.settings.pressureFlow?pressure:1,dp=this.settings.pressureDensity?pressure:1,speed=clamp((this.stroke?.speed||0)/.035),sd=lerp(1,1-speed*.78,this.settings.speedDensity/100);
      let amount=mask*(this.settings.flow/100)*(this.settings.opacity/100)*fp*dp*sd*flowScale;
      if(this.settings.densityJitter)amount*=clamp(1+this.rng.signed()*this.settings.densityJitter/100,0,2);
      const edge=this.adapter.getEdgeStrength?.(x,y)||0;if(this.settings.edgeMode==='protect')amount*=lerp(1,1-edge,this.settings.edgeStrength/100);if(this.settings.edgeMode==='enhance')amount*=lerp(1,1+edge,this.settings.edgeStrength/100);
      if(this.settings.preserveDetail)amount*=lerp(1,.35+Math.abs(old.density-.5),this.settings.preserveDetail/100);
      if(this.settings.directionalShading&&this.stroke){const light=this.settings.lightAngle*Math.PI/180,d=this.stroke.direction,dot=d.x*Math.cos(light)+d.y*Math.sin(light);amount*=clamp(.65+(-dot)*.35,.25,1.25)}
      let target=old.density,glyph=old.glyph;const mode=this.settings.mode;
      if(mode==='erase'){target=0;glyph=null}
      else if(mode==='lighten')target=clamp(old.density-amount);
      else if(mode==='darken'||mode==='density')target=clamp(old.density+amount);
      else if(mode==='random'){const cs=this.adapter.getCharset(),i=Math.floor(this.rng.next()*Math.max(1,cs.length));glyph=cs[i]||null;target=clamp(i/Math.max(1,cs.length-1))}
      else if(mode==='pattern'){glyph=this._patternGlyph(x,y);target=glyph===' '?old.density:clamp(old.density+amount)}
      else{glyph=this._glyphForDynamics(input);target=this.adapter.densityForGlyph?.(glyph)??1}
      if(!['lighten','darken','density','erase'].includes(mode)){const t=clamp(amount*(mode==='normal'?1.8:1));target=lerp(old.density,target,t)}
      target=this._blend(old.density,target,amount);
      if(this.settings.directionGlyphs)glyph=this._directionGlyph(glyph);
      if(this.settings.orientationGlyphs)glyph=this.adapter.getOrientationGlyph?.(x,y,glyph)||glyph;
      if(this.settings.glyphJitter&&this.rng.next()<this.settings.glyphJitter/100){const cs=this.adapter.getCharset();glyph=cs[Math.floor(this.rng.next()*cs.length)]||glyph}
      let color=this.adapter.getBrushColor?.(x,y)||old.color;if(this.settings.colorJitter)color=this._jitterColor(color,this.settings.colorJitter/100);
      this.adapter.setCell(x,y,{density:clamp(target),glyph:['density','lighten','darken'].includes(mode)?null:glyph,color});
    }
    _blend(oldValue,target,amount){const mode=this.settings.blendMode,a=clamp(amount);if(mode==='replace')return lerp(oldValue,target,a);if(mode==='subtract')return clamp(oldValue-target*a);if(mode==='max')return Math.max(oldValue,target*a);if(mode==='min')return Math.min(oldValue,lerp(oldValue,target,a));if(mode==='multiply')return lerp(oldValue,oldValue*target,a);if(mode==='screen')return lerp(oldValue,1-(1-oldValue)*(1-target),a);if(mode==='difference')return lerp(oldValue,Math.abs(oldValue-target),a);return clamp(oldValue+(target-oldValue)*a+(['density','darken'].includes(this.settings.mode)?a*.35:0));}
    _jitterColor(hex,amount){const v=String(hex||'#ffffff').replace('#','');if(!/^[0-9a-f]{6}$/i.test(v))return hex;const shift=()=>Math.round(this.rng.signed()*72*amount),h=n=>Math.round(clamp(n,0,255)).toString(16).padStart(2,'0');return`#${h(parseInt(v.slice(0,2),16)+shift())}${h(parseInt(v.slice(2,4),16)+shift())}${h(parseInt(v.slice(4,6),16)+shift())}`;}
    _glyphForDynamics(){const cs=this.adapter.getCharset();if(this.settings.glyphSequence&&cs.length){const g=cs[this.sequenceIndex%cs.length];this.sequenceIndex++;return g}return this.adapter.getSelectedGlyph?.()||'#';}
    _directionGlyph(fallback){const d=this.stroke?.direction||{x:1,y:0},a=((Math.atan2(d.y,d.x)*180/Math.PI%180)+180)%180;if(a<22.5||a>=157.5)return'-';if(a<67.5)return'\\';if(a<112.5)return'|';return'/';}
    _patternGlyph(x,y){const lines=String(this.settings.pattern||'#').replace(/\r/g,'').split('\n'),h=lines.length,w=Math.max(1,...lines.map(l=>Array.from(l).length)),row=Array.from(lines[((y%h)+h)%h]||'');return row[((x%w)+w)%w]||' ';}
    previewMatrix(size=17){const matrix=[],center=(size-1)/2,old=this.rng;this.rng=new RNG(this.settings.seed);for(let y=0;y<size;y++){const row=[];for(let x=0;x<size;x++){const nx=(x-center)/Math.max(1,center),ny=(y-center)/Math.max(1,center);let v=this._tipMask(nx,ny,x,y);v=this._falloff(v)*this._textureFactor(x,y,nx,ny);row.push(clamp(v))}matrix.push(row)}this.rng=old;return matrix;}
  }

  window.GlyphBrushEngine = { BrushEngine, DEFAULTS, PRESETS, clamp, lerp };
})();