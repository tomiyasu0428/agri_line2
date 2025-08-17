// StraightBar Lite – Visual (PWA)
// スマホGPSのみでのABライン横ズレ視覚化。A点→B点で基準線を定義。

const el = (id) => document.getElementById(id);
const statusText = el('statusText');
const deviationText = el('deviationText');
const dirArrow = el('dirArrow');
const targetText = el('targetText');
const abInfo = el('abInfo');
const centerBar = el('centerBar');
const cursor = el('cursor');
const visualSpan = el('visualSpan');
const rangeVisual = el('rangeVisual');
const rangeSmooth = el('rangeSmooth');
const debugText = el('debugText');
const btnA = el('btnSetA');
const btnB = el('btnSetB');
const btnClear = el('btnClear');
const btnWatch = el('btnWatch');

// State
let A = null; // {lat, lon}
let B = null; // {lat, lon}
let abLine = null; // {origin: A, dir: {x,y}, normal: {x,y}}
let watchId = null;
let lastUpdate = 0;
let smoothK = 0.5; // 0..0.95
let visualRange = 15; // ±m
let smoothedDeviation = 0; // EMA
let speedKmh = 0;
let heading = null; // degrees

// Utils
const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;

// Equirectangular projection around reference (A or current)
function project(lat, lon, refLat, refLon) {
  const x = toRad(lon - refLon) * Math.cos(toRad(refLat)) * 6371000;
  const y = toRad(lat - refLat) * 6371000;
  return {x, y};
}

function normalize(v){
  const n = Math.hypot(v.x, v.y) || 1;
  return {x: v.x/n, y: v.y/n};
}

function dot(a,b){return a.x*b.x + a.y*b.y}
function sub(a,b){return {x:a.x-b.x, y:a.y-b.y}}
function mul(a,s){return {x:a.x*s, y:a.y*s}}

function computeAB(){
  if(!A || !B) { abLine = null; return; }
  const pA = {x:0, y:0};
  const pB = project(B.lat, B.lon, A.lat, A.lon);
  const dir = normalize(sub(pB, pA));
  const normal = {x: -dir.y, y: dir.x};
  abLine = {origin: {lat:A.lat, lon:A.lon}, dir, normal};
  abInfo.textContent = `A: ${A.lat.toFixed(6)}, ${A.lon.toFixed(6)} / B: ${B.lat.toFixed(6)}, ${B.lon.toFixed(6)}`;
}

function deviationFromAB(lat, lon){
  if(!abLine) return {dev:0, side:0};
  const p = project(lat, lon, abLine.origin.lat, abLine.origin.lon);
  const dev = dot(p, abLine.normal); // meters, +right (East-ish) relative to AB direction
  const side = Math.sign(dev);
  return {dev, side};
}

function formatHz(lastTs){
  if(!lastTs) return '--';
  const dt = (performance.now() - lastTs)/1000;
  if(dt <= 0) return '--';
  return (1/Math.min(dt, 5)).toFixed(1);
}

function updateUI(){
  const dev = smoothedDeviation;
  const absDev = Math.abs(dev);
  deviationText.textContent = absDev.toFixed(1);
  dirArrow.textContent = dev >= 0 ? '右へ →' : '← 左へ';
  targetText.textContent = `横ズレ ${dev.toFixed(2)} m`;
  visualSpan.textContent = visualRange.toFixed(1);

  // move cursor within bar-container width
  const container = centerBar.parentElement; // bar-container
  const w = container.clientWidth;
  // map -visualRange..+visualRange to pixel offset
  const x = (dev / (visualRange)) * (w/2);
  cursor.style.left = `${Math.max(0, Math.min(w, w/2 + x))}px`;

  statusText.textContent = `GPS: ${watchId ? '取得中' : '停止'} / 精度: ${currentAcc?.toFixed(0) ?? '--'}m / 速度: ${speedKmh.toFixed(1)}km/h / 進行方位: ${heading ?? '--'}° / 更新: ${formatHz(lastUpdate)}Hz`;

  debugText.textContent = lastDebug;
}

let currentAcc = null;
let lastDebug = '';

function onPosition(pos){
  lastUpdate = performance.now();
  const { latitude: lat, longitude: lon, speed, heading: head, accuracy } = pos.coords;
  speedKmh = speed != null ? (speed * 3.6) : speedKmh;
  heading = head != null ? Math.round(head) : heading;
  currentAcc = accuracy ?? null;

  if(!A) return; // wait for A

  const { dev } = deviationFromAB(lat, lon);
  // EMA smoothing
  smoothedDeviation = smoothK * smoothedDeviation + (1 - smoothK) * dev;

  lastDebug = `rawDev=${dev.toFixed(2)}, smooth=${smoothedDeviation.toFixed(2)}, acc=${(accuracy||0).toFixed(1)}`;
  updateUI();
}

function onError(err){
  const codeMap = {1:'PERMISSION_DENIED',2:'POSITION_UNAVAILABLE',3:'TIMEOUT'};
  const code = codeMap[err.code] || err.code;
  lastDebug = `error code=${code} message=${err.message}`;
  statusText.textContent = `GPSエラー: ${err.message} (${code})`;
  if(code==='POSITION_UNAVAILABLE' || code==='TIMEOUT'){
    scheduleWatchRestart();
  }
}

function startWatch(){
  if(watchId) return;
  if(!('geolocation' in navigator)){
    alert('この端末はGeolocationに対応していません');
    return;
  }
  try{
    if(navigator.permissions && navigator.permissions.query){
      navigator.permissions.query({name:'geolocation'}).then(res=>{
        lastDebug = `perm=${res.state}`;
        updateUI();
      }).catch(()=>{});
    }
  }catch(_){/* ignore */}
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 20000,
  });
  btnWatch.textContent = 'GPS停止';
  updateUI();
}

function stopWatch(){
  if(!watchId) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
  btnWatch.textContent = 'GPS開始';
  updateUI();
}

let retryTimer = null;
let retryDelay = 3000; // ms, increases up to 30s
function scheduleWatchRestart(){
  if(retryTimer) return;
  retryTimer = setTimeout(()=>{
    retryTimer = null;
    if(watchId){
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    startWatch();
    retryDelay = Math.min(retryDelay * 1.5, 30000);
  }, retryDelay);
}

// Watchdog: if no update for 15s, restart watch
setInterval(()=>{
  if(!watchId) return;
  const age = (performance.now() - lastUpdate)/1000;
  if(age > 15){
    if(navigator.geolocation && watchId){
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
      startWatch();
    }
  }
}, 5000);

btnWatch.addEventListener('click', ()=>{
  if(watchId) stopWatch(); else startWatch();
});

btnA.addEventListener('click', ()=>{
  if(!navigator.geolocation) return alert('Geolocation未対応');
  navigator.geolocation.getCurrentPosition((pos)=>{
    A = {lat: pos.coords.latitude, lon: pos.coords.longitude};
    btnB.disabled = false;
    computeAB();
    updateUI();
  }, onError, { enableHighAccuracy:true, timeout:15000 });
});

btnB.addEventListener('click', ()=>{
  if(!navigator.geolocation) return alert('Geolocation未対応');
  navigator.geolocation.getCurrentPosition((pos)=>{
    B = {lat: pos.coords.latitude, lon: pos.coords.longitude};
    computeAB();
    updateUI();
  }, onError, { enableHighAccuracy:true, timeout:15000 });
});

btnClear.addEventListener('click', ()=>{
  A = B = abLine = null;
  smoothedDeviation = 0;
  btnB.disabled = true;
  abInfo.textContent = 'A: 未設定 / B: 未設定';
  updateUI();
});

rangeVisual.addEventListener('input', ()=>{
  visualRange = Number(rangeVisual.value);
  updateUI();
});

rangeSmooth.addEventListener('input', ()=>{
  smoothK = Number(rangeSmooth.value);
});

// PWA
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js');
}

updateUI();
