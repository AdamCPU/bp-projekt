// suradnice su v cm, theta v radianoch, 0 = smer +x, kladne je dolava

const config = require('./config.json');

let startX = config.floorPlan.startXCm;
let startY = config.floorPlan.startYCm;
let startTheta = config.floorPlan.startThetaRad;

let x = startX, y = startY, theta = startTheta;
let trail = [{ x, y, t: Date.now() }];
let pwmTable = [...(config.calibration.pwmTable || [])];
let turnDeadTime = config.calibration.turnDeadTimeSec ?? 0.15;

function speedAt(pwm) {
    if (pwmTable.length === 0) return { v: 0, w: 0 };
    const sorted = [...pwmTable].sort((a, b) => a.pwm - b.pwm);
    if (pwm <= sorted[0].pwm) return { v: sorted[0].vCmPerSec, w: sorted[0].omegaRadPerSec };
    const last = sorted[sorted.length - 1];
    if (pwm >= last.pwm) return { v: last.vCmPerSec, w: last.omegaRadPerSec };
    for (let i = 0; i < sorted.length - 1; i++) {
        if (pwm >= sorted[i].pwm && pwm <= sorted[i + 1].pwm) {
            const t = (pwm - sorted[i].pwm) / (sorted[i + 1].pwm - sorted[i].pwm);
            return {
                v: sorted[i].vCmPerSec + t * (sorted[i + 1].vCmPerSec - sorted[i].vCmPerSec),
                w: sorted[i].omegaRadPerSec + t * (sorted[i + 1].omegaRadPerSec - sorted[i].omegaRadPerSec),
            };
        }
    }
    return { v: 0, w: 0 };
}

function setPwmTable(table) { pwmTable = table || []; }
function setTurnDeadTime(t) { turnDeadTime = t ?? 0.15; }

function applyMotion(dir, pwm, deltaSec) {
    const { v, w } = speedAt(pwm);
    switch (dir) {
        case 'ahead': x += v * deltaSec * Math.cos(theta); y -= v * deltaSec * Math.sin(theta); break;
        case 'back':  x -= v * deltaSec * Math.cos(theta); y += v * deltaSec * Math.sin(theta); break;
        case 'left':  theta = normAngle(theta + w * Math.max(0, deltaSec - turnDeadTime)); break;
        case 'right': theta = normAngle(theta - w * Math.max(0, deltaSec - turnDeadTime)); break;
    }
    trail.push({ x, y, t: Date.now() });
}

function normAngle(a) {
    while (a > Math.PI)  a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

function setStart(newX, newY, newTheta) { startX = newX; startY = newY; startTheta = newTheta; }

function reset() {
    x = startX; y = startY; theta = startTheta;
    trail = [{ x, y, t: Date.now() }];
}

function clearTrail() { trail = [{ x, y, t: Date.now() }]; }
function snapshot()   { return { x, y, theta, t: Date.now() }; }
function getTrail()   { return trail.slice(); }

// odhadnuta poloha pocas pohybu, nemutuje stav - pouziva sa pre live update na mape
function liveSnapshot(dir, pwm, dt) {
    const { v, w } = speedAt(pwm);
    let lx = x, ly = y, lt = theta;
    switch (dir) {
        case 'ahead': lx += v * dt * Math.cos(lt); ly -= v * dt * Math.sin(lt); break;
        case 'back':  lx -= v * dt * Math.cos(lt); ly += v * dt * Math.sin(lt); break;
        case 'left':  lt = normAngle(lt + w * Math.max(0, dt - turnDeadTime)); break;
        case 'right': lt = normAngle(lt - w * Math.max(0, dt - turnDeadTime)); break;
    }
    return { x: lx, y: ly, theta: lt, t: Date.now() };
}

module.exports = { applyMotion, setStart, reset, clearTrail, snapshot, getTrail, setPwmTable, setTurnDeadTime, liveSnapshot };
