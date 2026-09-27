/* =========================================================
   奶蛙跑酷 · 迷你 WebGL 3D 引擎（自研，零第三方库）
   —— 矩阵(列主序) / 着色器 / 网格 / 贴图 / 渲染状态
   ========================================================= */
'use strict';

const M4 = {
  ident() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
  /* 列主序：out = a * b */
  mul(a, b, out) {
    out = out || new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
      }
    }
    return out;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0]);
  },
  lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ]);
  },
  /* 平移+绕Y旋转+缩放，列主序 */
  compose(px, py, pz, ry, sx, sy, sz, rx) {
    const c = Math.cos(ry || 0), s = Math.sin(ry || 0);
    sx = sx == null ? 1 : sx; sy = sy == null ? 1 : sy; sz = sz == null ? 1 : sz;
    let m = new Float32Array([
      c * sx, 0, -s * sx, 0,
      0, sy, 0, 0,
      s * sz, 0, c * sz, 0,
      px, py, pz, 1,
    ]);
    if (rx) {   // 追加绕 X 轴旋转（用于平躺的公告牌/地面贴片）
      const cr = Math.cos(rx), sr = Math.sin(rx);
      const rot = new Float32Array([1,0,0,0, 0,cr,sr,0, 0,-sr,cr,0, 0,0,0,1]);
      m = M4.mul(m, rot);
    }
    return m;
  },
};

const GLS = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUV;
uniform mat4 uMVP; uniform mat4 uModel; uniform vec2 uUVScale; uniform float uCamZ;
varying vec3 vNormal; varying vec2 vUV; varying float vViewZ;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vUV = aUV * uUVScale;
  vViewZ = uCamZ - wp.z;              // 相机前方的距离（用于雾）
}`;

const FSH = `
precision mediump float;
varying vec3 vNormal; varying vec2 vUV; varying float vViewZ;
uniform sampler2D uTex; uniform float uUseTex; uniform vec4 uColor;
uniform vec3 uLight; uniform float uNight; uniform float uUnlit;
uniform float uAlpha; uniform float uFogStart; uniform float uFogEnd; uniform vec4 uFogColor;
uniform float uFogAmount;
void main(){
  vec4 base = uColor;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUV);
  vec3 col;
  if (uUnlit > 0.5) {
    col = base.rgb;
  } else {
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, normalize(uLight)), 0.0);
    float amb = mix(0.60, 0.34, uNight);
    // 半球补光，弱光面也不至于死黑
    float hemi = 0.18 * (n.y * 0.5 + 0.5);
    col = base.rgb * (amb + hemi + diff * 0.62);
    // 简单的边缘提亮（类卡通高光）
    float rim = pow(1.0 - abs(n.z), 2.0) * 0.10;
    col += vec3(rim);
  }
  float fog = clamp((vViewZ - uFogStart) / max(1.0, uFogEnd - uFogStart), 0.0, 1.0) * uFogAmount;
  col = mix(col, uFogColor.rgb, fog);
  gl_FragColor = vec4(col, base.a * uAlpha);
}`;

const GL3D = {
  gl: null, canvas: null, W: 0, H: 0, dpr: 1,
  prog: null, loc: {}, texCache: {},
  failed: false,

  init(canvas) {
    this.canvas = canvas;
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance', depth: true })
        || canvas.getContext('experimental-webgl', { antialias: false });
    } catch (e) { gl = null; }
    if (!gl) { this.failed = true; return false; }
    this.gl = gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, GLS));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FSH));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.failed = true; return false; }
    this.prog = p; gl.useProgram(p);
    ['aPos', 'aNormal', 'aUV'].forEach(n => { this.loc[n] = gl.getAttribLocation(p, n); });
    ['uMVP', 'uModel', 'uTex', 'uUseTex', 'uColor', 'uLight', 'uNight', 'uUnlit', 'uAlpha',
      'uFogStart', 'uFogEnd', 'uFogColor', 'uFogAmount', 'uUVScale', 'uCamZ']
      .forEach(n => { this.loc[n] = gl.getUniformLocation(p, n); });
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  },

  resize(w, h, dpr) {
    if (!this.gl) return;
    const W = Math.max(2, Math.floor(w * dpr)), H = Math.max(2, Math.floor(h * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.W = W; this.H = H; this.dpr = dpr;
    this.gl.viewport(0, 0, W, H);
  },

  /* ---------------- 网格 ---------------- */
  buffer(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  },
  makeMesh(pos, nor, uv, idx, uvDefault) {
    const gl = this.gl;
    const m = {
      n: idx.length, pos: this.buffer(pos), nor: this.buffer(nor), uv: this.buffer(uv),
      idx: gl.createBuffer(), uvs: uvDefault || [1, 1],
    };
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return m;
  },
  cube() {
    if (this._cube) return this._cube;
    const faces = [
      { n: [0, 0, 1], v: [[-0.5,-0.5,0.5],[0.5,-0.5,0.5],[0.5,0.5,0.5],[-0.5,0.5,0.5]] },
      { n: [0, 0, -1], v: [[0.5,-0.5,-0.5],[-0.5,-0.5,-0.5],[-0.5,0.5,-0.5],[0.5,0.5,-0.5]] },
      { n: [1, 0, 0], v: [[0.5,-0.5,0.5],[0.5,-0.5,-0.5],[0.5,0.5,-0.5],[0.5,0.5,0.5]] },
      { n: [-1, 0, 0], v: [[-0.5,-0.5,-0.5],[-0.5,-0.5,0.5],[-0.5,0.5,0.5],[-0.5,0.5,-0.5]] },
      { n: [0, 1, 0], v: [[-0.5,0.5,0.5],[0.5,0.5,0.5],[0.5,0.5,-0.5],[-0.5,0.5,-0.5]] },
      { n: [0, -1, 0], v: [[-0.5,-0.5,-0.5],[0.5,-0.5,-0.5],[0.5,-0.5,0.5],[-0.5,-0.5,0.5]] },
    ];
    const pos = [], nor = [], uv = [], idx = [];
    faces.forEach((f, fi) => {
      const o = fi * 4;
      f.v.forEach((p, i) => {
        pos.push(p[0], p[1], p[2]); nor.push(f.n[0], f.n[1], f.n[2]);
        uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1);
      });
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    this._cube = this.makeMesh(pos, nor, uv, idx);
    return this._cube;
  },
  plane() {
    if (this._plane) return this._plane;
    this._plane = this.makeMesh(
      [-0.5,-0.5,0, 0.5,-0.5,0, 0.5,0.5,0, -0.5,0.5,0],
      [0,0,1, 0,0,1, 0,0,1, 0,0,1],
      [0,1, 1,1, 1,0, 0,0],
      [0,1,2, 0,2,3]
    );
    return this._plane;
  },
  cylinder(seg) {
    seg = seg || 14;
    const key = 'cyl' + seg;
    if (this[key]) return this[key];
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
      pos.push(cx, -0.5, cz); nor.push(cx * 2, 0, cz * 2); uv.push(i / seg, 1);
      pos.push(cx, 0.5, cz); nor.push(cx * 2, 0, cz * 2); uv.push(i / seg, 0);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    // 顶盖 / 底盖
    const cTop = pos.length / 3;
    pos.push(0, 0.5, 0); nor.push(0, 1, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a) * 0.5, 0.5, Math.sin(a) * 0.5); nor.push(0, 1, 0);
      uv.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5);
    }
    for (let i = 0; i < seg; i++) idx.push(cTop, cTop + 1 + i, cTop + 2 + i);
    const cBot = pos.length / 3;
    pos.push(0, -0.5, 0); nor.push(0, -1, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5); nor.push(0, -1, 0);
      uv.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5);
    }
    for (let i = 0; i < seg; i++) idx.push(cBot, cBot + 2 + i, cBot + 1 + i);
    const m = this.makeMesh(pos, nor, uv, idx);
    this[key] = m;
    return m;
  },
  cone(seg) {
    seg = seg || 14;
    if (this._cone) return this._cone;
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
      pos.push(cx, -0.5, cz); nor.push(cx * 1.2, 0.45, cz * 1.2); uv.push(i / seg, 1);
      pos.push(0, 0.5, 0); nor.push(cx * 1.2, 0.45, cz * 1.2); uv.push(i / seg, 0);
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    const cBot = pos.length / 3;
    pos.push(0, -0.5, 0); nor.push(0, -1, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2;
      pos.push(Math.cos(a) * 0.5, -0.5, Math.sin(a) * 0.5); nor.push(0, -1, 0);
      uv.push(Math.cos(a) * 0.5 + 0.5, Math.sin(a) * 0.5 + 0.5);
    }
    for (let i = 0; i < seg; i++) idx.push(cBot, cBot + 2 + i, cBot + 1 + i);
    this._cone = this.makeMesh(pos, nor, uv, idx);
    return this._cone;
  },

  drawMesh(m, uvScale) {
    const gl = this.gl;
    const bind = (buf, loc, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind(m.pos, this.loc.aPos, 3);
    bind(m.nor, this.loc.aNormal, 3);
    bind(m.uv, this.loc.aUV, 2);
    gl.uniform2f(this.loc.uUVScale, uvScale ? uvScale[0] : 1, uvScale ? uvScale[1] : 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
    gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_SHORT, 0);
  },

  /* ---------------- 贴图 ---------------- */
  texture(url) {
    if (this.texCache[url]) return this.texCache[url];
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([210, 210, 210, 255]));
    const im = new Image();
    im.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (this.mipmap !== false) {
        try {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } catch (e) { /* 非 2 次幂忽略 */ }
      }
      this.texCache[url] = t;
    };
    im.onerror = () => { this.texCache[url] = null; };
    im.src = url;
    this.texCache[url] = t;
    return t;
  },
  textureFromCanvas(cv) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  },

  /* ---------------- 帧与绘制 ---------------- */
  frame(camPos, camTarget, th, W, H, dpr) {
    const gl = this.gl;
    this.resize(W, H, dpr);
    gl.clearColor(th.skyBot[0], th.skyBot[1], th.skyBot[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.view = M4.lookAt(camPos, camTarget, [0, 1, 0]);
    this.proj = M4.perspective((CFG.FOV_Y || 58) * Math.PI / 180, this.W / this.H, 0.28, Math.max(120, CFG.FAR + 60));
    this.vp = M4.mul(this.proj, this.view);
    this.camPos = camPos;
    this.theme = th;
    gl.uniform1f(this.loc.uCamZ, camPos[2]);
    gl.uniform3f(this.loc.uLight, th.light[0], th.light[1], th.light[2]);
    gl.uniform1f(this.loc.uNight, th.night || 0);
    gl.uniform1f(this.loc.uFogStart, 26);
    gl.uniform1f(this.loc.uFogEnd, CFG.FAR * 0.92);
    gl.uniform4f(this.loc.uFogColor, th.fog[0], th.fog[1], th.fog[2], 1);
    gl.uniform1f(this.loc.uFogAmount, th.fogAmount == null ? 0.92 : th.fogAmount);
  },
  draw(mesh, model, o) {
    const gl = this.gl;
    o = o || {};
    gl.uniformMatrix4fv(this.loc.uModel, false, model);
    gl.uniformMatrix4fv(this.loc.uMVP, false, M4.mul(this.vp, model));
    const col = o.color || [1, 1, 1];
    gl.uniform4f(this.loc.uColor, col[0], col[1], col[2], o.alpha == null ? 1 : o.alpha);
    gl.uniform1f(this.loc.uAlpha, o.alpha == null ? 1 : o.alpha);
    gl.uniform1f(this.loc.uUnlit, o.unlit ? 1 : 0);
    if (o.tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.tex);
      gl.uniform1i(this.loc.uTex, 0);
      gl.uniform1f(this.loc.uUseTex, 1);
    } else {
      gl.uniform1f(this.loc.uUseTex, 0);
    }
    const alphaBlend = (o.alpha != null && o.alpha < 1) || o.blend;
    if (alphaBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
    const cull = !o.doubleSide;
    if (cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    if (o.noDepth) gl.disable(gl.DEPTH_TEST);
    this.drawMesh(mesh, o.uvScale);
    if (o.noDepth) gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  },

  /* 世界坐标 → 屏幕像素（供 2D 叠加层使用） */
  project(x, y, z) {
    const m = this.vp;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 0.0001) return null;
    const ndcX = cx / cw, ndcY = cy / cw;
    const W = this.W / this.dpr, H = this.H / this.dpr;
    // 每单位世界长度对应的像素（近似，用于缩放 2D 叠加元素）
    const focal = (H * 0.5) / Math.tan((CFG.FOV_Y || 58) * Math.PI / 360);
    return { sx: (ndcX * 0.5 + 0.5) * W, sy: (0.5 - ndcY * 0.5) * H, s: focal / cw, w: cw };
  },
};

/* 颜色工具：hex → [r,g,b] 0..1 */
function hex2rgb(hex) {
  if (hex && hex[0] !== '#') {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(hex || '');
    if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
    return [0.5, 0.5, 0.5];
  }
  const p = parseInt((hex || '#808080').slice(1), 16);
  return [((p >> 16) & 255) / 255, ((p >> 8) & 255) / 255, (p & 255) / 255];
}
function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
