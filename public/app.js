const socket = io();

const statusEl    = document.getElementById('status');
const modeEl      = document.getElementById('mode');
const poseEl      = document.getElementById('pose');
const distanceEl  = document.getElementById('distance');
const speedEl     = document.getElementById('speed');
const travelledEl = document.getElementById('travelled');
const mapScaleEl  = document.getElementById('map-scale');

const canvas     = document.getElementById('map');
const ctx        = canvas.getContext('2d');
const cameraEl   = document.getElementById('camera');
const pwmInput   = document.getElementById('pwm');
const pwmDisplay = document.getElementById('pwm-display');
const trimSlider  = document.getElementById('trim-slider');
const trimValueEl = document.getElementById('trim-value');

let cfg   = null;
let trail = [];
let pose  = { x: 0, y: 0, theta: 0 };
let goal  = null;
let latestUltrasonic = null;
let latestState      = { mode: 'IDLE', pwm: 0 };

const floorImg = new Image();
floorImg.onload  = () => {
    canvas.width  = floorImg.naturalWidth;
    canvas.height = floorImg.naturalHeight;
    redraw();
};
floorImg.onerror = redraw;

socket.on('connect',    () => { statusEl.textContent = 'Pripojený';  statusEl.className = 'status connected'; });
socket.on('disconnect', () => { statusEl.textContent = 'Odpojený';   statusEl.className = 'status disconnected'; });

socket.on('config', c => {
    cfg = c;
    canvas.width  = cfg.floorPlan.imageWidthPx;
    canvas.height = cfg.floorPlan.imageHeightPx;
    floorImg.src  = cfg.floorPlan.imagePath + '?t=' + Date.now(); // cache busting - prehliadac by inak zobrazoval stary obrazok
    if (cfg.camera.enabled) cameraEl.src = cfg.camera.url;

    if (c.calibration?.trimOffset != null) {
        trimSlider.value = c.calibration.trimOffset;
        trimValueEl.textContent = c.calibration.trimOffset;
    }
    if (c.calibration?.turnDeadTimeSec != null)
        document.getElementById('dead-time-input').value = c.calibration.turnDeadTimeSec;

    mapScaleEl.textContent = `${c.floorPlan.cmPerPixel.toFixed(3)} cm/px`;

    renderPwmTable(c.calibration?.pwmTable || []);
    updateMapPageInfo(c);
    redraw();
});

socket.on('pose',     p => { pose = p; updatePoseLabel(); redraw(); });
socket.on('trail',    t => { trail = t.points; redraw(); updateTravelled(); });
socket.on('goal',     g => { goal = g; redraw(); });
socket.on('state',    s => { latestState = s; modeEl.textContent = `${s.mode} @ ${s.pwm}%`; updateSpeed(s.mode, s.pwm); });
socket.on('distance', d => { latestUltrasonic = d.cm; distanceEl.textContent = d.cm !== null ? `${d.cm} cm` : '--'; });
socket.on('estop',    () => { distanceEl.style.color = '#f44'; setTimeout(() => distanceEl.style.color = '', 1000); });

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.getElementById('page-' + id).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    if (id === 'dashboard') redraw();
    if (id === 'map') updateMapPreview();
    if (id === 'log') renderLogTable();
}

document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => showPage(btn.dataset.page)));

pwmInput.addEventListener('input', () => { pwmDisplay.textContent = pwmInput.value; });

// passive: false treba kvoli preventDefault, inak prehliadac nezablokuje nativny scroll pocas jazdy nakoniec na mobiloch nefunguje nestihol som to implementovat
document.querySelectorAll('.dpad button[data-dir]').forEach(btn => {
    const dir = btn.dataset.dir;
    const send    = e => { e.preventDefault(); socket.emit('drive', { dir, pwm: Number(pwmInput.value) }); };
    const release = e => { e.preventDefault(); if (dir !== 'stop') socket.emit('drive', { dir: 'stop' }); };
    btn.addEventListener('mousedown',  send);
    btn.addEventListener('touchstart', send, { passive: false });
    btn.addEventListener('mouseup',    release);
    btn.addEventListener('mouseleave', release);
    btn.addEventListener('touchend',   release, { passive: false });
});

document.querySelectorAll('.dpad button[data-cam]').forEach(btn => {
    const dir = btn.dataset.cam;
    const send = e => { e.preventDefault(); socket.emit('cam_move', { dir }); };
    btn.addEventListener('click',      send);
    btn.addEventListener('touchstart', send, { passive: false });
});

socket.on('cam_angles', ({ pan, tilt }) => {
    const el = document.getElementById('cam-angles');
    if (el) el.textContent = `Pan ${pan}° Tilt ${tilt}°`;
});

document.getElementById('reset-pose').onclick  = () => socket.emit('reset_pose');
document.getElementById('clear-trail').onclick = () => socket.emit('clear_trail');

canvas.addEventListener('click', e => {
    if (!cfg) return;
    const r  = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) * (canvas.width  / r.width);
    const py = (e.clientY - r.top)  * (canvas.height / r.height);
    socket.emit('set_goal', { x_cm: px * cfg.floorPlan.cmPerPixel, y_cm: py * cfg.floorPlan.cmPerPixel });
});

function cmToPx(cm) { return cm / cfg.floorPlan.cmPerPixel; }

function redraw() {
    if (!cfg) return;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (floorImg.complete && floorImg.naturalWidth > 0) {
        ctx.drawImage(floorImg, 0, 0);
    } else {
        const cx = canvas.width / 2, cy = canvas.height / 2;
        ctx.fillStyle = '#222'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#444'; ctx.fillRect(cx - 200, cy - 70, 400, 140);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#888'; ctx.font = 'bold 20px system-ui'; ctx.fillText('Žiadny pôdorys', cx, cy - 20);
        ctx.fillStyle = '#2a7'; ctx.font = '14px system-ui';      ctx.fillText('Prejdite na stránku Mapa pre nastavenie', cx, cy + 14);
        ctx.textAlign = 'left';
    }

    if (trail.length > 1) {
        ctx.strokeStyle = '#3a7'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cmToPx(trail[0].x), cmToPx(trail[0].y));
        for (let i = 1; i < trail.length; i++) ctx.lineTo(cmToPx(trail[i].x), cmToPx(trail[i].y));
        ctx.stroke();
    }

    if (goal) {
        ctx.fillStyle = '#fc0';
        ctx.beginPath(); ctx.arc(cmToPx(goal.x_cm), cmToPx(goal.y_cm), 8, 0, 2 * Math.PI); ctx.fill();
    }

    ctx.save();
    ctx.translate(cmToPx(pose.x), cmToPx(pose.y));
    ctx.rotate(-pose.theta);
    ctx.fillStyle = '#c33';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, 8); ctx.lineTo(-8, -8); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function updatePoseLabel() {
    poseEl.textContent = `x=${pose.x.toFixed(0)} y=${pose.y.toFixed(0)} θ=${(pose.theta * 180 / Math.PI).toFixed(0)}°`;
}

function clientSpeedAt(pwm, table) {
    if (!table || table.length === 0) return 0;
    const sorted = [...table].sort((a, b) => a.pwm - b.pwm);
    if (pwm <= sorted[0].pwm) return sorted[0].vCmPerSec;
    const last = sorted[sorted.length - 1];
    if (pwm >= last.pwm) return last.vCmPerSec;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (pwm >= sorted[i].pwm && pwm <= sorted[i + 1].pwm) {
            const t = (pwm - sorted[i].pwm) / (sorted[i + 1].pwm - sorted[i].pwm);
            return sorted[i].vCmPerSec + t * (sorted[i + 1].vCmPerSec - sorted[i].vCmPerSec);
        }
    }
    return 0;
}

function updateSpeed(mode, pwm) {
    if (!cfg || mode === 'IDLE' || mode === 'TURNING') { speedEl.textContent = '0 cm/s'; return; }
    const v = clientSpeedAt(pwm, cfg.calibration?.pwmTable);
    speedEl.textContent = `${v.toFixed(0)} cm/s`;
}

function updateTravelled() {
    let d = 0;
    for (let i = 1; i < trail.length; i++) d += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
    travelledEl.textContent = d >= 100 ? `${(d / 100).toFixed(2)} m` : `${d.toFixed(0)} cm`;
}

function updateMapPageInfo(c) {
    document.getElementById('info-scale').textContent = `${c.floorPlan.cmPerPixel.toFixed(3)} cm/px`;
    document.getElementById('info-size').textContent  = `${c.floorPlan.imageWidthPx} × ${c.floorPlan.imageHeightPx} px`;
    document.getElementById('info-start').textContent =
        `x=${c.floorPlan.startXCm.toFixed(0)}, y=${c.floorPlan.startYCm.toFixed(0)}, θ=${(c.floorPlan.startThetaRad * 180 / Math.PI).toFixed(0)}°`;
}

function updateMapPreview() {
    const img = document.getElementById('map-preview-img');
    if (cfg?.floorPlan?.imagePath) img.src = cfg.floorPlan.imagePath + '?t=' + Date.now();
}

function renderPwmTable(table) {
    const tbody = document.getElementById('pwm-cal-tbody');
    tbody.innerHTML = '';
    if (!table || table.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-entries">Žiadne záznamy — skalibrujte vyššie</td></tr>';
        return;
    }
    [...table].sort((a, b) => a.pwm - b.pwm).forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${entry.pwm}%</td><td>${entry.vCmPerSec.toFixed(1)} cm/s</td><td>${entry.omegaRadPerSec.toFixed(3)} rad/s</td><td><button class="del-btn" data-pwm="${entry.pwm}">✕</button></td>`;
        tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.del-btn').forEach(btn =>
        btn.addEventListener('click', () => postCalibrate({ deletePwm: parseInt(btn.dataset.pwm, 10) })));
}

async function postCalibrate(body) {
    const resp = await fetch('/api/calibrate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return resp.ok;
}

function getCalPwm() { return parseInt(document.getElementById('cal-test-pwm').value, 10) || 30; }

function runCalibDrive(dir, durationMs, btn) {
    return new Promise(resolve => {
        const pwm = getCalPwm();
        btn.disabled = true; btn.textContent = '…prebieha';
        socket.emit('drive', { dir, pwm, durationMs });
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = dir === 'ahead' ? '▶ Jazdiť 2s' : '↺ Otočiť 1s';
            resolve(pwm);
        }, durationMs + 200);
    });
}

document.getElementById('btn-cal-linear').addEventListener('click', () =>
    runCalibDrive('ahead', 2000, document.getElementById('btn-cal-linear')));

document.getElementById('btn-cal-turn').addEventListener('click', () =>
    runCalibDrive('left', 1000, document.getElementById('btn-cal-turn')));

document.getElementById('btn-cal-linear-save').addEventListener('click', async () => {
    const cm  = parseFloat(document.getElementById('cal-linear-cm').value);
    const pwm = getCalPwm();
    if (!cm || cm <= 0) { alert('Najprv zadajte nameranú vzdialenosť v cm.'); return; }
    const vCmPerSec = cm / 2;
    const existing = cfg?.calibration?.pwmTable?.find(e => e.pwm === pwm);
    const omegaRadPerSec = existing?.omegaRadPerSec ?? 0;
    if (await postCalibrate({ pwmEntry: { pwm, vCmPerSec, omegaRadPerSec } })) {
        document.getElementById('cal-linear-result').textContent = `Uložené: ${vCmPerSec.toFixed(1)} cm/s @ ${pwm}%`;
        document.getElementById('cal-linear-cm').value = '';
    }
});

document.getElementById('btn-cal-turn-save').addEventListener('click', async () => {
    const deg = parseFloat(document.getElementById('cal-turn-deg').value);
    const pwm = getCalPwm();
    if (!deg || deg <= 0) { alert('Najprv zadajte nameraný uhol v stupňoch.'); return; }
    const deadTime = cfg?.calibration?.turnDeadTimeSec ?? 0.15;
    const omegaRadPerSec = (deg * Math.PI / 180) / Math.max(0.01, 1.0 - deadTime);
    const existing = cfg?.calibration?.pwmTable?.find(e => e.pwm === pwm);
    const vCmPerSec = existing?.vCmPerSec ?? 0;
    if (await postCalibrate({ pwmEntry: { pwm, vCmPerSec, omegaRadPerSec } })) {
        document.getElementById('cal-turn-result').textContent = `Uložené: ${omegaRadPerSec.toFixed(3)} rad/s @ ${pwm}%`;
        document.getElementById('cal-turn-deg').value = '';
    }
});

document.getElementById('btn-dead-time-save').addEventListener('click', async () => {
    const t = parseFloat(document.getElementById('dead-time-input').value);
    if (isNaN(t) || t < 0) { alert('Zadajte hodnotu medzi 0 a 0,5'); return; }
    if (await postCalibrate({ turnDeadTimeSec: t }))
        document.getElementById('dead-time-result').textContent = `Uložené: ${t}s`;
});

trimSlider.addEventListener('input', () => { trimValueEl.textContent = trimSlider.value; });

document.getElementById('btn-trim-save').addEventListener('click', async () => {
    const t = parseInt(trimSlider.value, 10);
    if (await postCalibrate({ trimOffset: t }))
        document.getElementById('trim-result').textContent = `Uložené: ${t > 0 ? '+' : ''}${t}`;
});

const setupOverlay   = document.getElementById('setup-overlay');
const drawCanvas     = document.getElementById('draw-canvas');
const drawCtx        = drawCanvas.getContext('2d');
const poseCanvas     = document.getElementById('pose-canvas');
const poseCtx        = poseCanvas.getContext('2d');
const mapSearchInput = document.getElementById('map-search');

let leafletMap = null;
let selectionBounds = null, selectionRect = null, drawingRect = false, rectStart = null;
let walls = [], drawTool = 'wall', isDrawing = false, drawStart = null, drawMousePos = null;
let satImage = new Image(), satMeta = null, imageSource = 'upload';
let drawEventsBound = false, calibPoints = [];
let startPose = null, poseEvtsBound = false, composedImg = null;

function showSetupScreen(id) {
    ['setup-map-screen', 'setup-draw-screen', 'setup-pose-screen'].forEach(s =>
        document.getElementById(s).classList.toggle('hidden', s !== id));
    if (id === 'setup-pose-screen') initPoseCanvas();
}

function openSetup() {
    setupOverlay.classList.remove('hidden');
    showSetupScreen('setup-map-screen');
    setMapMode('upload');
    if (!satMeta && cfg?.floorPlan?.cmPerPixel > 0)
        satMeta = { cmPerPixel: cfg.floorPlan.cmPerPixel };
}

function closeSetup() { setupOverlay.classList.add('hidden'); }

document.getElementById('btn-setup').addEventListener('click', openSetup);
document.getElementById('btn-cancel-setup').addEventListener('click', closeSetup);
document.getElementById('btn-back-to-map').addEventListener('click',  () => showSetupScreen('setup-map-screen'));
document.getElementById('btn-back-to-draw').addEventListener('click', () => showSetupScreen('setup-draw-screen'));
document.getElementById('btn-confirm-map').addEventListener('click',  () => showSetupScreen('setup-pose-screen'));

function setMapMode(mode) {
    document.getElementById('upload-panel').classList.toggle('hidden', mode !== 'upload');
    document.getElementById('google-panel').classList.toggle('hidden', mode !== 'google');
    document.getElementById('mode-btn-upload').classList.toggle('active', mode === 'upload');
    document.getElementById('mode-btn-google').classList.toggle('active', mode === 'google');
    if (mode === 'google') {
        initLeafletMap();
        setTimeout(() => leafletMap?.invalidateSize(), 100);
    }
}

document.getElementById('mode-btn-upload').addEventListener('click', () => setMapMode('upload'));
document.getElementById('mode-btn-google').addEventListener('click', () => setMapMode('google'));

function calcCmPerPixel(lat, zoom) {
    // mapbox pouziva 512px dlazdice namiesto 256px (preto zoom -1) a vracia ~853px namiesto 1280px
    // faktor 0.75 = (1/2) * (4/3) opravuje obe odchylky naraz
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom) * 100 * 0.75;
}

function initLeafletMap() {
    if (leafletMap) { leafletMap.invalidateSize(); return; }
    leafletMap = L.map('gmap', { zoomControl: true }).setView([48.1486, 17.1077], 18);
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/{z}/{x}/{y}?access_token=${cfg.mapboxToken}`, {
        attribution: '© <a href="https://www.mapbox.com/">Mapbox</a>',
        maxZoom: 22,
        tileSize: 512,
        zoomOffset: -1,
    }).addTo(leafletMap);

    leafletMap.on('mousedown', e => {
        if (!drawingRect) return;
        rectStart = e.latlng;
    });
    leafletMap.on('mousemove', e => {
        if (!drawingRect || !rectStart) return;
        if (selectionRect) leafletMap.removeLayer(selectionRect);
        selectionRect = L.rectangle(L.latLngBounds(rectStart, e.latlng), {
            color: '#ffcc00', weight: 2, fillOpacity: 0.15, interactive: false,
        }).addTo(leafletMap);
    });
    leafletMap.on('mouseup', e => {
        if (!drawingRect || !rectStart) return;
        drawingRect = false;
        leafletMap.dragging.enable();
        leafletMap.getContainer().style.cursor = '';
        selectionBounds = L.latLngBounds(rectStart, e.latlng);
        rectStart = null;
        const btn = document.getElementById('btn-use-building');
        btn.textContent = 'Použiť výber ▶';
        btn.disabled = false;
        document.getElementById('map-draw-hint').classList.add('hidden');
        document.getElementById('btn-clear-selection').classList.remove('hidden');
    });
}

document.getElementById('btn-map-search').addEventListener('click', async () => {
    const query = mapSearchInput.value.trim();
    if (!query || !leafletMap) return;
    const btn = document.getElementById('btn-map-search');
    btn.disabled = true; btn.textContent = '…';
    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`);
        const results = await resp.json();
        if (!results.length) { alert('Adresa nenájdená'); return; }
        leafletMap.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 19);
    } catch (e) { alert('Vyhľadávanie zlyhalo: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Hľadať'; }
});

mapSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-map-search').click(); });

function cancelSelection() {
    drawingRect = false;
    rectStart = null;
    selectionBounds = null;
    if (selectionRect) { leafletMap.removeLayer(selectionRect); selectionRect = null; }
    if (leafletMap) { leafletMap.dragging.enable(); leafletMap.getContainer().style.cursor = ''; }
    document.getElementById('btn-use-building').textContent = 'Kresliť výber';
    document.getElementById('btn-use-building').disabled = false;
    document.getElementById('btn-clear-selection').classList.add('hidden');
    document.getElementById('map-draw-hint').classList.add('hidden');
}

document.getElementById('btn-clear-selection').addEventListener('click', cancelSelection);

// toto tlacidlo ma tri stavy podla toho kde sa pouzivatel nachadza
document.getElementById('btn-use-building').addEventListener('click', async () => {
    if (!leafletMap) return;

    if (drawingRect) {
        cancelSelection();
        return;
    }

    if (!selectionBounds) {
        // este ziadny vyber - prepni do rezimu kreslenia oblasti
        drawingRect = true;
        if (selectionRect) { leafletMap.removeLayer(selectionRect); selectionRect = null; }
        leafletMap.dragging.disable();
        leafletMap.getContainer().style.cursor = 'crosshair';
        document.getElementById('btn-use-building').textContent = 'Zrušiť';
        document.getElementById('btn-clear-selection').classList.add('hidden');
        document.getElementById('map-draw-hint').classList.remove('hidden');
        return;
    }

    // uz ma vyber - vypocitaj zoom a stiahni satelitny obrazok
    const west  = selectionBounds.getWest(),  east  = selectionBounds.getEast();
    const south = selectionBounds.getSouth(), north = selectionBounds.getNorth();
    const latCenter = (south + north) / 2;
    const lngCenter = (west + east) / 2;
    const cosLat  = Math.cos(latCenter * Math.PI / 180);
    const widthM  = (east - west)  * 111320 * cosLat;
    const heightM = (north - south) * 111320;

    // zoom zvolime tak aby dlhsia strana budovy zabrala ~853px (mapbox vrati 2/3 z 1280px)
    const maxM    = Math.max(widthM, heightM);
    const zoom    = Math.min(22, Math.floor(Math.log2(156543.03392 * cosLat * 853 * 0.75 / maxM)));
    const cmPerPx = 156543.03392 * cosLat / Math.pow(2, zoom) * 100 * 0.75;

    const btn = document.getElementById('btn-use-building');
    btn.disabled = true; btn.textContent = 'Načítanie…';
    document.getElementById('btn-clear-selection').classList.add('hidden');
    const resp = await fetch(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lngCenter},${latCenter},${zoom}/1280x1280?access_token=${cfg.mapboxToken}`);
    btn.disabled = false; btn.textContent = 'Kresliť výber';
    if (!resp.ok) {
        document.getElementById('btn-clear-selection').classList.remove('hidden');
        const err = await resp.json().catch(() => ({}));
        alert('Satelitný snímok zlyhal: ' + resp.status + '\n' + (err.error || ''));
        return;
    }

    imageSource = 'satellite';
    const blob = await resp.blob();
    satImage = new Image();
    satImage.onload = () => {
        // mierka sa pocita zo zoom urovne, nie z rozmerov obrazka - tie su nepredvidatelne
        satMeta = { cmPerPixel: cmPerPx };
        selectionBounds = null;
        if (selectionRect) { leafletMap.removeLayer(selectionRect); selectionRect = null; }
        enterDrawPhase();
    };
    satImage.src = URL.createObjectURL(blob);
});

document.getElementById('upload-input').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const cmVal = parseFloat(document.getElementById('upload-cm-per-pixel').value);
    if (!cmVal || cmVal <= 0) { alert('Najprv zadajte platnú hodnotu cm/px.'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
        satMeta = { cmPerPixel: cmVal }; imageSource = 'upload';
        satImage = new Image(); satImage.onload = enterDrawPhase; satImage.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

function enterDrawPhase() {
    walls = [];
    drawCanvas.width = satImage.naturalWidth; drawCanvas.height = satImage.naturalHeight;
    redrawDrawCanvas();
    showSetupScreen('setup-draw-screen');
    if (!drawEventsBound) { bindDrawEvents(); drawEventsBound = true; }
}

function redrawDrawCanvas() {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.drawImage(satImage, 0, 0);
    drawCtx.strokeStyle = '#fff'; drawCtx.lineWidth = 3; drawCtx.lineCap = 'round';
    walls.forEach(w => { drawCtx.beginPath(); drawCtx.moveTo(w.x1, w.y1); drawCtx.lineTo(w.x2, w.y2); drawCtx.stroke(); });
    if (isDrawing && drawStart && drawMousePos) {
        drawCtx.strokeStyle = 'rgba(255,220,0,0.85)'; drawCtx.lineWidth = 2; drawCtx.setLineDash([6, 3]);
        drawCtx.beginPath(); drawCtx.moveTo(drawStart.x, drawStart.y); drawCtx.lineTo(drawMousePos.x, drawMousePos.y); drawCtx.stroke();
        drawCtx.setLineDash([]);
    }
    if (calibPoints.length > 0) {
        drawCtx.fillStyle = drawCtx.strokeStyle = '#0cf'; drawCtx.lineWidth = 1.5;
        calibPoints.forEach(p => { drawCtx.beginPath(); drawCtx.arc(p.x, p.y, 5, 0, 2 * Math.PI); drawCtx.fill(); });
        if (calibPoints.length === 2) {
            drawCtx.beginPath(); drawCtx.moveTo(calibPoints[0].x, calibPoints[0].y); drawCtx.lineTo(calibPoints[1].x, calibPoints[1].y); drawCtx.stroke();
        }
    }
}

function getCanvasPos(cvs, e) {
    const r   = cvs.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (cvs.width / r.width), y: (src.clientY - r.top) * (cvs.height / r.height) };
}

function pointerFromTouch(e) {
    const t = e.changedTouches[0];
    return { clientX: t.clientX, clientY: t.clientY };
}

function bindDrawEvents() {
    drawCanvas.addEventListener('mousedown', e => {
        const pos = getCanvasPos(drawCanvas, e);
        if (drawTool === 'wall') {
            isDrawing = true; drawStart = pos; drawMousePos = pos;
        } else if (drawTool === 'eraser') {
            eraseNear(pos);
        } else if (drawTool === 'calibrate') {
            if (calibPoints.length >= 2) calibPoints = [];
            calibPoints.push(pos);
            if (calibPoints.length === 2) document.getElementById('calib-hint').classList.remove('hidden');
            redrawDrawCanvas();
        }
    });
    drawCanvas.addEventListener('mousemove', e => {
        if (!isDrawing) return;
        drawMousePos = getCanvasPos(drawCanvas, e); redrawDrawCanvas();
    });
    const commitWall = e => {
        if (!isDrawing) return;
        const pos = getCanvasPos(drawCanvas, e);
        if (Math.hypot(pos.x - drawStart.x, pos.y - drawStart.y) > 4)
            walls.push({ x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y });
        isDrawing = false; drawStart = null; drawMousePos = null; redrawDrawCanvas();
    };
    drawCanvas.addEventListener('mouseup', commitWall);
    drawCanvas.addEventListener('mouseleave', () => {
        if (isDrawing) { isDrawing = false; drawStart = null; drawMousePos = null; redrawDrawCanvas(); }
    });
    // touch eventy preposielame ako mouse eventy, passive:false kvoli preventDefault
    drawCanvas.addEventListener('touchstart', e => { e.preventDefault(); drawCanvas.dispatchEvent(new MouseEvent('mousedown', pointerFromTouch(e))); }, { passive: false });
    drawCanvas.addEventListener('touchmove',  e => { e.preventDefault(); drawCanvas.dispatchEvent(new MouseEvent('mousemove',  pointerFromTouch(e))); }, { passive: false });
    drawCanvas.addEventListener('touchend',   e => { e.preventDefault(); drawCanvas.dispatchEvent(new MouseEvent('mouseup',    pointerFromTouch(e))); }, { passive: false });
}

function eraseNear(pos) {
    const before = walls.length;
    walls = walls.filter(w => distToSegment(pos, w) > 10);
    if (walls.length !== before) redrawDrawCanvas();
}

function distToSegment(p, w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - w.x1, p.y - w.y1);
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / lenSq));
    return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

function setDrawTool(tool) {
    drawTool = tool;
    drawCanvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
    ['wall', 'eraser', 'calibrate'].forEach(t =>
        document.getElementById(`tool-${t}`).classList.toggle('active', t === tool));
    document.getElementById('calib-hint').classList.toggle('hidden', tool !== 'calibrate' || calibPoints.length < 2);
    if (tool !== 'calibrate') { calibPoints = []; redrawDrawCanvas(); }
}

document.getElementById('tool-wall').addEventListener('click',      () => setDrawTool('wall'));
document.getElementById('tool-eraser').addEventListener('click',    () => setDrawTool('eraser'));
document.getElementById('tool-calibrate').addEventListener('click', () => setDrawTool('calibrate'));

document.getElementById('btn-apply-calib').addEventListener('click', () => {
    const distM = parseFloat(document.getElementById('calib-dist').value);
    if (!distM || distM <= 0) { alert('Zadajte platnú vzdialenosť v metroch.'); return; }
    if (calibPoints.length < 2) { alert('Najprv kliknite na dva referenčné body.'); return; }
    const pixelDist = Math.hypot(calibPoints[1].x - calibPoints[0].x, calibPoints[1].y - calibPoints[0].y);
    satMeta.cmPerPixel = (distM * 100) / pixelDist;
    document.getElementById('cmp-display').textContent = `Mierka: ${satMeta.cmPerPixel.toFixed(3)} cm/px`;
    document.getElementById('calib-dist').value = '';
    calibPoints = [];
    setDrawTool('wall');
    redrawDrawCanvas();
});

document.getElementById('btn-cancel-calib').addEventListener('click', () => {
    document.getElementById('calib-dist').value = '';
    calibPoints = [];
    setDrawTool('wall');
    redrawDrawCanvas();
});

document.getElementById('btn-clear-walls').addEventListener('click', () => { walls = []; redrawDrawCanvas(); });

function buildComposedImage() {
    const off = document.createElement('canvas');
    off.width = satImage.naturalWidth; off.height = satImage.naturalHeight;
    const octx = off.getContext('2d');
    octx.drawImage(satImage, 0, 0);
    octx.strokeStyle = '#fff'; octx.lineWidth = 3; octx.lineCap = 'round';
    walls.forEach(w => { octx.beginPath(); octx.moveTo(w.x1, w.y1); octx.lineTo(w.x2, w.y2); octx.stroke(); });
    return off;
}

function initPoseCanvas() {
    const off = buildComposedImage();
    composedImg = new Image();
    composedImg.onload = redrawPoseCanvas;
    composedImg.src = off.toDataURL('image/png');
    poseCanvas.width = off.width;
    poseCanvas.height = off.height;
    startPose = null;
    if (!poseEvtsBound) { bindPoseEvents(); poseEvtsBound = true; }
}

function redrawPoseCanvas() {
    poseCtx.clearRect(0, 0, poseCanvas.width, poseCanvas.height);
    if (composedImg?.complete) poseCtx.drawImage(composedImg, 0, 0);
    if (!startPose) return;
    const { xPx, yPx, theta } = startPose;
    poseCtx.save(); poseCtx.translate(xPx, yPx); poseCtx.rotate(-theta);
    poseCtx.strokeStyle = '#fc0'; poseCtx.lineWidth = 2;
    poseCtx.beginPath(); poseCtx.moveTo(0, 0); poseCtx.lineTo(28, 0); poseCtx.stroke();
    poseCtx.fillStyle = '#c33';
    poseCtx.beginPath(); poseCtx.moveTo(14, 0); poseCtx.lineTo(-8, 8); poseCtx.lineTo(-8, -8); poseCtx.closePath(); poseCtx.fill();
    poseCtx.restore();
}

let directionLocked = false;

function poseRobotScreenPos() {
    const r = poseCanvas.getBoundingClientRect();
    return {
        x: r.left + startPose.xPx * (r.width  / poseCanvas.width),
        y: r.top  + startPose.yPx * (r.height / poseCanvas.height),
    };
}

function updatePoseDirection(clientX, clientY) {
    if (!startPose || directionLocked) return;
    const p = poseRobotScreenPos();
    const dx = clientX - p.x, dy = clientY - p.y;
    if (Math.hypot(dx, dy) > 8) { startPose.theta = Math.atan2(-dy, dx); redrawPoseCanvas(); }
}

document.addEventListener('mousemove', e => {
    if (document.getElementById('setup-pose-screen').classList.contains('hidden')) return;
    updatePoseDirection(e.clientX, e.clientY);
});

document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (document.getElementById('setup-pose-screen').classList.contains('hidden')) return;
    e.preventDefault();
    directionLocked = !directionLocked;
    const ind = document.getElementById('pose-lock-indicator');
    ind.textContent = directionLocked ? 'Uzamknuté' : '';
});

function bindPoseEvents() {
    poseCanvas.addEventListener('mousedown', e => {
        const pos = getCanvasPos(poseCanvas, e);
        startPose = { xPx: pos.x, yPx: pos.y, theta: startPose?.theta ?? 0 };
        directionLocked = false;
        document.getElementById('pose-lock-indicator').textContent = '';
        redrawPoseCanvas();
    });
    poseCanvas.addEventListener('touchstart', e => {
        e.preventDefault();
        poseCanvas.dispatchEvent(new MouseEvent('mousedown', pointerFromTouch(e)));
    }, { passive: false });
    poseCanvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!startPose || directionLocked) return;
        const t = e.touches[0];
        updatePoseDirection(t.clientX, t.clientY);
    }, { passive: false });
    poseCanvas.addEventListener('touchend', e => { e.preventDefault(); }, { passive: false });
}

document.getElementById('btn-confirm-pose').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-pose');
    btn.disabled = true; btn.textContent = 'Ukladanie…';
    const resp = await fetch('/api/save-floorplan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageDataUrl:  composedImg.src,
            cmPerPixel:    satMeta.cmPerPixel,
            widthPx:       poseCanvas.width,
            heightPx:      poseCanvas.height,
            startXCm:      startPose ? startPose.xPx * satMeta.cmPerPixel : null,
            startYCm:      startPose ? startPose.yPx * satMeta.cmPerPixel : null,
            startThetaRad: startPose?.theta ?? null,
            walls, source: imageSource,
        }),
    });
    btn.disabled = false; btn.textContent = '✓ Uložiť mapu';
    if (resp.ok) { closeSetup(); }
    else if (resp.status === 413) { alert('Ukladanie zlyhalo: obrázok je príliš veľký (limit 20 MB).'); }
    else { alert('Ukladanie zlyhalo: ' + ((await resp.json().catch(() => ({}))).error || resp.status)); }
});

let sessionLog   = [];
let sessionStart = Date.now();
let logInterval  = null;

function totalDistCm() {
    let d = 0;
    for (let i = 1; i < trail.length; i++)
        d += Math.hypot(trail[i].x - trail[i-1].x, trail[i].y - trail[i-1].y);
    return d;
}

function resetLog() {
    sessionLog   = [];
    sessionStart = Date.now();
    renderLogTable();
}

async function captureLogEntry() {
    const elapsed = Math.round((Date.now() - sessionStart) / 1000);
    const dist    = totalDistCm();
    const speed   = (latestState.mode === 'DRIVING')
        ? clientSpeedAt(latestState.pwm, cfg?.calibration?.pwmTable)
        : 0;

    const entry = {
        t:          elapsed,
        x:          pose.x.toFixed(1),
        y:          pose.y.toFixed(1),
        theta:      (pose.theta * 180 / Math.PI).toFixed(0),
        dist:       dist.toFixed(0),
        speed:      speed.toFixed(1),
        ultrasonic: latestUltrasonic != null ? latestUltrasonic.toFixed(0) : '—',
        snapshot:   null,
    };

    try {
        // timeout 3s - kamera moze byt pomala alebo nedostupna, nechceme blokovat zapis
        const r = await fetch('/api/snapshot', { signal: AbortSignal.timeout(3000) });
        if (r.ok && r.headers.get('content-type')?.includes('image/jpeg'))
            entry.snapshot = URL.createObjectURL(await r.blob());
    } catch (_) {}

    sessionLog.push(entry);
    renderLogTable();
}

function renderLogTable() {
    const tbody = document.getElementById('log-tbody');
    const countEl = document.getElementById('log-count');
    if (!tbody) return;
    countEl.textContent = `${sessionLog.length} záznamov`;
    tbody.innerHTML = '';
    if (!sessionLog.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-entries">Žiadne dáta — záznamy každých 10 s</td></tr>';
        return;
    }
    for (const e of [...sessionLog].reverse()) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${e.t}s</td>
            <td>${e.x}</td>
            <td>${e.y}</td>
            <td>${e.theta}°</td>
            <td>${e.dist} cm</td>
            <td>${e.speed} cm/s</td>
            <td>${e.ultrasonic} cm</td>
            <td>${e.snapshot ? `<a href="${e.snapshot}" download="snapshot-${e.t}s.jpg"><img src="${e.snapshot}" class="log-snap" title="Kliknúť pre stiahnutie"></a>` : '—'}</td>
        `;
        tbody.appendChild(tr);
    }
}

function exportLogCSV() {
    const lines = ['Time(s),X(cm),Y(cm),Heading(deg),TotalDist(cm),Speed(cm/s),Ultrasonic(cm)'];
    sessionLog.forEach(e =>
        lines.push(`${e.t},${e.x},${e.y},${e.theta},${e.dist},${e.speed},${e.ultrasonic}`)
    );
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `robot-log-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    a.click();
}

function setLogRecording(active) {
    if (active && !logInterval) {
        logInterval = setInterval(captureLogEntry, 10000);
        document.getElementById('btn-log-toggle').textContent = '■ Zastaviť';
        document.getElementById('btn-log-toggle').style.background = '#c33';
        document.getElementById('log-status').textContent = 'Nahrávanie každých 10 s…';
        document.getElementById('log-status').style.color = '#2a7';
    } else if (!active && logInterval) {
        clearInterval(logInterval);
        logInterval = null;
        document.getElementById('btn-log-toggle').textContent = '▶ Spustiť';
        document.getElementById('btn-log-toggle').style.background = '';
        document.getElementById('log-status').textContent = 'Zastavený';
        document.getElementById('log-status').style.color = '#555';
    }
}

document.getElementById('btn-log-toggle').addEventListener('click', () => setLogRecording(!logInterval));
document.getElementById('btn-log-clear').addEventListener('click', resetLog);
document.getElementById('btn-log-export').addEventListener('click', exportLogCSV);
document.getElementById('btn-log-snapshots').addEventListener('click', () => {
    const snaps = sessionLog.filter(e => e.snapshot);
    if (!snaps.length) { alert('Zatiaľ žiadne snímky.'); return; }
    // 400ms pauza medzi stiahnutiami - bez toho niektore prehliadace ignoruju simultanne stiahnutia
    snaps.forEach((e, i) => setTimeout(() => {
        const a = document.createElement('a');
        a.href = e.snapshot;
        a.download = `snapshot-${e.t}s.jpg`;
        a.click();
    }, i * 400));
});

// reset polohy vynuluje aj zaznam - nechceme miesat data z roznych behov
document.getElementById('reset-pose').addEventListener('click', () => {
    setLogRecording(false);
    resetLog();
});
