// Interactive 3D hero. Chrome + glossy-black sculptural blobs (smooth, bubbly shapes and mirror finish inspired by the
// pink reference, recoloured for the black-and-white theme) plus a cursor-reactive particle field.
// three.js is loaded lazily; if WebGL or the CDN is unavailable, mountScene resolves to null and a CSS fallback is shown.
export async function mountScene(el, onEnter) {
  let THREE, RoomEnvironment, mergeVertices, renderer;
  try {
    THREE = await import('three');
    ({RoomEnvironment} = await import('three/addons/environments/RoomEnvironment.js'));
    ({mergeVertices} = await import('three/addons/utils/BufferGeometryUtils.js'));
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  } catch (e) {console.warn('3D unavailable, using fallback:', e.message); return null}

  const small = innerWidth < 700, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  el.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, 1, .1, 60); cam.position.z = 8;
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 5); scene.add(key);

  const sculpt = (geo, fn) => {
    geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
    const g = mergeVertices(geo, 1e-4), p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z)}
    g.computeVertexNormals(); return g;
  };
  const blobFn = s => v => {const n = v.clone().normalize(); const k = 1 + .17 * Math.sin(n.x * 3.1 + 1.2) * Math.cos(n.y * 2.7) + .12 * Math.sin(n.z * 3.7 + n.x * 2) + .06 * Math.sin(n.y * 6 + n.z * 4); v.copy(n).multiplyScalar(s * k)};
  const ringFn = v => {const th = Math.atan2(v.y, v.x), c = new THREE.Vector3(Math.cos(th) * 1.15, Math.sin(th) * 1.15, 0), d = v.clone().sub(c); d.multiplyScalar(1 + .38 * Math.sin(3 * th + .6)); d.z += .18 * Math.sin(2 * th); v.copy(c.add(d))};
  const dotTex = (() => {const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c)})();

  const chrome = new THREE.MeshPhysicalMaterial({color: 0xffffff, metalness: 1, roughness: .06, envMapIntensity: 1.5});
  const gloss = new THREE.MeshPhysicalMaterial({color: 0x050505, metalness: .35, roughness: .1, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.3});
  const blob = new THREE.Mesh(sculpt(new THREE.SphereGeometry(1, 110, 80), blobFn(1.5)), chrome);
  const ring = new THREE.Mesh(sculpt(new THREE.TorusGeometry(1, .5, 64, 140), ringFn), gloss);
  const drop = new THREE.Mesh(sculpt(new THREE.SphereGeometry(1, 70, 50), blobFn(.6)), chrome);
  const beads = new THREE.Group(), bg = new THREE.SphereGeometry(1, 32, 24);
  for (let i = 0; i < 7; i++) {const m = new THREE.Mesh(bg, i % 3 ? chrome : gloss); m.scale.setScalar(.08 + (i % 4) * .05); m.userData = {a: i * .9, rad: 2.1 + (i % 3) * .35, y: (i % 5 - 2) * .35}; beads.add(m)}
  const hit = [blob, ring, drop]; scene.add(blob, ring, drop, beads);

  const N = small ? 380 : 950, pos = new Float32Array(N * 3), home = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({size: .075, map: dotTex, transparent: true, opacity: .75, depthWrite: false}));
  scene.add(pts);

  let W = 1, H = 1, halfW = 1, halfH = 1, aspect = 1;
  const base = () => aspect < .9 ? {b: [.6, 1.7], r: [-.9, -.4], d: [-1.4, 2.4], s: .6} : {b: [2.5, .35], r: [-.2, -2.05], d: [-3.6, 2.2], s: 1};
  const layout = () => {const L = base(); blob.position.set(L.b[0], L.b[1], 0); blob.scale.setScalar(L.s * 1.05); ring.position.set(L.r[0], L.r[1], -1); ring.scale.setScalar(L.s * .95); drop.position.set(L.d[0], L.d[1], -1.5); drop.scale.setScalar(L.s); beads.position.copy(blob.position); beads.scale.setScalar(L.s)};
  const resize = () => {
    W = el.clientWidth || 1; H = el.clientHeight || 1; aspect = W / H; renderer.setSize(W, H); cam.aspect = aspect; cam.updateProjectionMatrix();
    halfH = Math.tan(THREE.MathUtils.degToRad(20)) * cam.position.z; halfW = halfH * aspect; layout();
    for (let i = 0; i < N; i++) {const k = i * 3; home[k] = (Math.random() * 2 - 1) * halfW * 1.25; home[k + 1] = (Math.random() * 2 - 1) * halfH * 1.25; home[k + 2] = -3 + Math.random() * 5; pos[k] = home[k]; pos[k + 1] = home[k + 1]; pos[k + 2] = home[k + 2]}
  };
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  const mouse = {x: 0, y: 0, wx: 1e3, wy: 1e3}, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let burst = 0, bx = 0, by = 0;
  const toNdc = e => {const r = el.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)};
  const onMove = e => {toNdc(e); mouse.x = ndc.x; mouse.y = ndc.y; mouse.wx = ndc.x * halfW; mouse.wy = ndc.y * halfH; ray.setFromCamera(ndc, cam); el.style.cursor = ray.intersectObjects(hit).length ? 'pointer' : 'default'};
  const onLeave = () => {mouse.wx = mouse.wy = 1e3; mouse.x = mouse.y = 0};
  const onDown = e => {toNdc(e); bx = ndc.x * halfW; by = ndc.y * halfH; burst = 1};
  const onDbl = e => {toNdc(e); ray.setFromCamera(ndc, cam); if (ray.intersectObjects(hit).length) onEnter()};
  el.addEventListener('pointermove', onMove); el.addEventListener('pointerleave', onLeave); el.addEventListener('pointerdown', onDown); el.addEventListener('dblclick', onDbl);

  let visible = true, raf = 0; const clock = new THREE.Clock();
  const io = new IntersectionObserver(([e]) => {visible = e.isIntersecting}); io.observe(el);
  const loop = () => {
    raf = requestAnimationFrame(loop); if (!visible || document.hidden) return;
    const t = clock.getElapsedTime() * (reduce ? .25 : 1), L = base();
    blob.rotation.y = t * .25 + mouse.x * .35; blob.rotation.x = Math.sin(t * .4) * .2 - mouse.y * .25; blob.position.y += (Math.sin(t * .8) * .12 + L.b[1] - blob.position.y) * .05;
    ring.rotation.x = t * .3 - mouse.y * .25; ring.rotation.y = t * .22 + mouse.x * .35; ring.position.y += (Math.sin(t * .6 + 1) * .1 + L.r[1] - ring.position.y) * .05;
    drop.rotation.y = -t * .3; drop.rotation.z = t * .2; drop.position.x += (L.d[0] + mouse.x * .3 - drop.position.x) * .04;
    beads.children.forEach(m => {const u = m.userData; m.position.set(Math.cos(t * .5 + u.a) * u.rad, u.y + Math.sin(t + u.a) * .15, Math.sin(t * .5 + u.a) * u.rad * .6)});
    cam.position.x += (mouse.x * .5 - cam.position.x) * .04; cam.position.y += (mouse.y * .35 - cam.position.y) * .04; cam.lookAt(0, 0, 0);
    const R = 1.7, R2 = R * R;
    for (let i = 0; i < N; i++) {
      const k = i * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const dx = x - mouse.wx, dy = y - mouse.wy, d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 1e-4) {const d = Math.sqrt(d2), f = (1 - d / R) * .05; vel[k] += dx / d * f; vel[k + 1] += dy / d * f}
      if (burst > 0) {const ex = x - bx, ey = y - by, ed = Math.hypot(ex, ey) || 1; if (ed < 3.5) {const f = (1 - ed / 3.5) * .5; vel[k] += ex / ed * f; vel[k + 1] += ey / ed * f}}
      vel[k] += (home[k] + Math.sin(t * .5 + i) * .08 - x) * .012; vel[k + 1] += (home[k + 1] + Math.cos(t * .4 + i * 1.3) * .08 - y) * .012; vel[k + 2] += (home[k + 2] - z) * .012;
      vel[k] *= .9; vel[k + 1] *= .9; vel[k + 2] *= .9; pos[k] = x + vel[k]; pos[k + 1] = y + vel[k + 1]; pos[k + 2] = z + vel[k + 2];
    }
    burst = 0; pg.attributes.position.needsUpdate = true; renderer.render(scene, cam);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); el.removeEventListener('pointerdown', onDown); el.removeEventListener('dblclick', onDbl);
    scene.traverse(o => o.geometry?.dispose?.()); [chrome, gloss, pts.material].forEach(m => m.dispose()); pm.dispose(); renderer.dispose(); renderer.domElement.remove();
  };
}
