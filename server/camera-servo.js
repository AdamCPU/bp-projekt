const config = require('./config.json');

const PAN_PIN  = config.servos.panY;  // GPIO 6 — horizontalne
const TILT_PIN = config.servos.panX;  // GPIO 7 — vertikalne

const STEP         = 10;
const PAN_CENTER   = 100;
const TILT_CENTER  = 80;  // priamo dopredu
const MIN          = 0;
const MAX          = 180;

let panAngle  = PAN_CENTER;
let tiltAngle = TILT_CENTER;
let panServo  = null;
let tiltServo = null;

// sirka impulzu podla vzorca z dokumentacie Keyestudio KS0223
function pulse(deg) { return Math.round(deg * 11 + 500); }
function clamp(v)   { return Math.max(MIN, Math.min(MAX, v)); }

try {
    const { Gpio } = require('pigpio');
    panServo  = new Gpio(PAN_PIN,  { mode: Gpio.OUTPUT });
    tiltServo = new Gpio(TILT_PIN, { mode: Gpio.OUTPUT });
    panServo.servoWrite(pulse(PAN_CENTER));
    tiltServo.servoWrite(pulse(TILT_CENTER));
    console.log('servos kamery inicializovane (GPIO', PAN_PIN, '/', TILT_PIN, ')');
} catch (e) {
    console.warn('servos kamery nie su dostupne (pigpio zlyhal):', e.message);
}

function apply() {
    if (panServo)  panServo.servoWrite(pulse(panAngle));
    if (tiltServo) tiltServo.servoWrite(pulse(tiltAngle));
}

function move(dir) {
    switch (dir) {
        case 'left':   tiltAngle = clamp(tiltAngle + STEP); break;
        case 'right':  tiltAngle = clamp(tiltAngle - STEP); break;
        case 'up':     panAngle  = clamp(panAngle  - STEP); break;
        case 'down':   panAngle  = clamp(panAngle  + STEP); break;
        case 'center': panAngle  = PAN_CENTER; tiltAngle = TILT_CENTER; break;
    }
    apply();
    return getAngles();
}

function getAngles() { return { pan: panAngle, tilt: tiltAngle, panCenter: PAN_CENTER, tiltCenter: TILT_CENTER }; }

function stop() {
    if (panServo)  panServo.servoWrite(0);
    if (tiltServo) tiltServo.servoWrite(0);
}

module.exports = { move, getAngles, stop };
