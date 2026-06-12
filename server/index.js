// hlavny bod vstupu servera, spaja express a socket.io s motormi a poziciou

const express = require('express');
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const { Server } = require('socket.io');
const path = require('path');

const motor     = require('./motor');
const pose      = require('./pose');
const sensor    = require('./sensor');
const camServo  = require('./camera-servo');
const config    = require('./config.json');

// floorplan.json je vytvoreny serverom na RPi a neprebiva deployom z Windows
// pouzijeme ho ako zdroj pre nastavenia podorysu ak existuje
try {
    const metaPath = path.join(__dirname, '..', 'public', 'floorplan.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.cmPerPixel        > 0)    config.floorPlan.cmPerPixel    = meta.cmPerPixel;
    if (meta.imageWidthPx      > 0)    config.floorPlan.imageWidthPx  = meta.imageWidthPx;
    if (meta.imageHeightPx     > 0)    config.floorPlan.imageHeightPx = meta.imageHeightPx;
    if (meta.startPose?.xCm    != null) config.floorPlan.startXCm     = meta.startPose.xCm;
    if (meta.startPose?.yCm    != null) config.floorPlan.startYCm     = meta.startPose.yCm;
    if (meta.startPose?.thetaRad != null) config.floorPlan.startThetaRad = meta.startPose.thetaRad;
} catch (_) {}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// proxy pre mapbox satelitne obrazky, token zostane na serveri
app.get('/api/satellite-image', (req, res) => {
    const { lat, lng, zoom, west, south, east, north } = req.query;
    const token = config.mapboxToken;
    if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE')
        return res.status(500).json({ error: 'Nastavte mapboxToken v server/config.json' });

    let url;
    if (west != null && south != null && east != null && north != null) {
        url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/%5B${west},${south},${east},${north}%5D/1280x1280?access_token=${token}`;
    } else {
        if (!lat || !lng) return res.status(400).json({ error: 'lat a lng sú povinné' });
        const z = zoom || 20;
        url = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/${lng},${lat},${z}/1280x1280?access_token=${token}`;
    }
    https.get(url, mbRes => {
        if (mbRes.statusCode !== 200) {
            let body = '';
            mbRes.on('data', d => body += d);
            mbRes.on('end', () => res.status(502).json({ error: `Mapbox vrátil ${mbRes.statusCode}: ${body.trim()}` }));
            return;
        }
        res.setHeader('Content-Type', mbRes.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        mbRes.pipe(res);
    }).on('error', err => { console.error('chyba satelitneho proxy:', err); res.status(500).json({ error: err.message }); });
});

// proxy pre jednu snimku z kamery, riesi CORS problem s portom 8081
app.get('/api/snapshot', (req, res) => {
    http.get('http://127.0.0.1:8081/snapshot', camRes => {
        if (camRes.statusCode !== 200) { camRes.resume(); res.status(502).end(); return; }
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        camRes.pipe(res);
    }).on('error', err => res.status(502).json({ error: err.message }));
});

// ulozenie podorysu z canvas dataURL a aktualizacia configu
app.post('/api/save-floorplan', (req, res) => {
    const { imageDataUrl, cmPerPixel, widthPx, heightPx,
            startXCm, startYCm, startThetaRad,
            walls, source } = req.body;
    if (!imageDataUrl) return res.status(400).json({ error: 'imageDataUrl je povinný' });

    const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imgPath = path.join(__dirname, '..', 'public', 'floorplan.png');
    fs.writeFileSync(imgPath, Buffer.from(base64, 'base64'));

    config.floorPlan.imagePath     = '/floorplan.png';
    config.floorPlan.imageWidthPx  = widthPx    || 640;
    config.floorPlan.imageHeightPx = heightPx   || 640;
    config.floorPlan.cmPerPixel    = (cmPerPixel > 0) ? cmPerPixel : config.floorPlan.cmPerPixel;
    if (startXCm     != null) config.floorPlan.startXCm      = startXCm;
    if (startYCm     != null) config.floorPlan.startYCm      = startYCm;
    if (startThetaRad != null) config.floorPlan.startThetaRad = startThetaRad;

    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));

    // metadata k png suboru - zdroj, steny, startova poloha atd
    const meta = {
        source:       source || 'unknown',
        cmPerPixel:   config.floorPlan.cmPerPixel,
        walls:        walls || [],
        startPose:    { xCm: config.floorPlan.startXCm, yCm: config.floorPlan.startYCm, thetaRad: config.floorPlan.startThetaRad },
        imageWidthPx: config.floorPlan.imageWidthPx,
        imageHeightPx: config.floorPlan.imageHeightPx,
        savedAt:      new Date().toISOString(),
    };
    fs.writeFileSync(path.join(__dirname, '..', 'public', 'floorplan.json'), JSON.stringify(meta, null, 2));

    // okamzity reset polohy na novu startovu poziciu, obchodzi staru require cache
    pose.setStart(config.floorPlan.startXCm, config.floorPlan.startYCm, config.floorPlan.startThetaRad);
    pose.reset();

    io.emit('config', config);
    io.emit('trail', { points: pose.getTrail() });
    io.emit('pose', pose.snapshot());
    res.json({ ok: true });
});
// ulozenie kalibracnych hodnot
app.post('/api/calibrate', (req, res) => {
    const { pwmEntry, deletePwm, trimOffset, turnDeadTimeSec } = req.body;

    if (pwmEntry) {
        const { pwm, vCmPerSec, omegaRadPerSec } = pwmEntry;
        const table = config.calibration.pwmTable;
        const idx = table.findIndex(e => e.pwm === pwm);
        if (idx >= 0) table[idx] = { pwm, vCmPerSec, omegaRadPerSec };
        else table.push({ pwm, vCmPerSec, omegaRadPerSec });
        pose.setPwmTable(table);
    }

    if (deletePwm != null) {
        config.calibration.pwmTable = config.calibration.pwmTable.filter(e => e.pwm !== deletePwm);
        pose.setPwmTable(config.calibration.pwmTable);
    }

    if (trimOffset      != null) config.calibration.trimOffset      = trimOffset;
    if (turnDeadTimeSec != null) { config.calibration.turnDeadTimeSec = turnDeadTimeSec; pose.setTurnDeadTime(turnDeadTimeSec); }

    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    io.emit('config', config);
    res.json({ ok: true, calibration: config.calibration });
});

const server = http.createServer(app);
const io = new Server(server);

// stavovy automat
let mode = 'IDLE';                // IDLE | DRIVING | TURNING | ESTOP
let currentPwm = config.calibration.defaultPwm;
let motionStartedAt = null;       // cas zaciatku pohybu v ms
let motionDir = null;
let motionTimer = null;           // timer pre casovany pohyb
let goal = null;                  // { x_cm, y_cm } | null
let obstacleBlocked = false;      // true kym je prekazka blizsie ako 10 cm

function broadcastState() { io.emit('state', { mode, pwm: currentPwm }); }
function broadcastPose()  { io.emit('pose', pose.snapshot()); io.emit('trail', { points: pose.getTrail() }); }

function beginMotion(dir, pwm, durationMs) {
    if (obstacleBlocked && dir === 'ahead') return;
    // ak uz ideme a prikaz nie je stop, ignorujeme ho
    if (mode !== 'IDLE' && dir !== 'stop') return;

    // uzavriet predosly usek pohybu a posunout do pose estimatora
    endMotionIntoPose();

    if (dir === 'stop') {
        motor.stop();
        mode = 'IDLE';
        broadcastState();
        return;
    }

    motor.ACTIONS[dir](pwm);
    motionDir = dir;
    motionStartedAt = Date.now();
    currentPwm = pwm;
    mode = (dir === 'left' || dir === 'right') ? 'TURNING' : 'DRIVING';
    broadcastState();

    if (durationMs && durationMs > 0) {
        motionTimer = setTimeout(() => beginMotion('stop'), durationMs);
    }
}

function endMotionIntoPose() {
    if (motionTimer) { clearTimeout(motionTimer); motionTimer = null; }
    if (motionStartedAt && motionDir && motionDir !== 'stop') {
        const dt = (Date.now() - motionStartedAt) / 1000;
        pose.applyMotion(motionDir, currentPwm, dt);
        broadcastPose();
    }
    motionStartedAt = null;
    motionDir = null;
}

io.on('connection', socket => {
    // pociatocna synchronizacia - posle vsetko novemu klientovi
    socket.emit('config', config);
    socket.emit('trail', { points: pose.getTrail() });
    socket.emit('pose', pose.snapshot());
    socket.emit('state', { mode, pwm: currentPwm });
    socket.emit('goal', goal);
    socket.emit('distance', { cm: sensor.getLast() });
    socket.emit('cam_angles', camServo.getAngles());

    socket.on('drive', ({ dir, pwm, durationMs }) => {
        const p = (typeof pwm === 'number') ? pwm : config.calibration.defaultPwm;
        beginMotion(dir, p, durationMs);
    });

    socket.on('reset_pose', () => {
        pose.reset();
        io.emit('trail', { points: pose.getTrail() });
        broadcastPose();
    });

    socket.on('clear_trail', () => {
        pose.clearTrail();
        io.emit('trail', { points: pose.getTrail() });
    });

    socket.on('set_goal', g => {
        goal = g;
        io.emit('goal', goal);
    });

    socket.on('cam_move', ({ dir }) => {
        const angles = camServo.move(dir);
        io.emit('cam_angles', angles);
    });
});

sensor.start(cm => {
    io.emit('distance', { cm });
    if (cm < 20) {
        if (!obstacleBlocked) {
            obstacleBlocked = true;
            beginMotion('stop');
            io.emit('estop', { reason: 'obstacle' });
        }
    } else {
        obstacleBlocked = false;
    }
});

// live poloha pocas pohybu - klient vidi aktualizaciu kazdych 100ms bez cakania na stop
setInterval(() => {
    if (mode === 'IDLE' || !motionStartedAt || !motionDir) return;
    const dt = (Date.now() - motionStartedAt) / 1000;
    io.emit('pose', pose.liveSnapshot(motionDir, currentPwm, dt));
}, 100);

// bezpecnostne - zastavit motory pri vypnuti procesu
function safeShutdown() { try { motor.stop(); sensor.stop(); camServo.stop(); } catch (_) {} process.exit(0); }
process.on('SIGINT',  safeShutdown);
process.on('SIGTERM', safeShutdown);

server.listen(config.server.port, () => {
    console.log(`server bezi na porte :${config.server.port}`);
});
