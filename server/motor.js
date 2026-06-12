// ovladac motorov pre 4-kolesovy h-bridge cez pigpio
// rozmiestnenie pinov a smer pohybu prebrate z Keyestudio MainControl.py

const { Gpio } = require('pigpio');
const config = require('./config.json');

// inicializacia troch pinov pre kazdy motor
const wheels = {};
for (const [name, pins] of Object.entries(config.motors)) {
    wheels[name] = {
        in1: new Gpio(pins.in1, { mode: Gpio.OUTPUT }),
        in2: new Gpio(pins.in2, { mode: Gpio.OUTPUT }),
        pwm: new Gpio(pins.pwm, { mode: Gpio.OUTPUT }),
    };
    wheels[name].in1.digitalWrite(0);
    wheels[name].in2.digitalWrite(0);
    wheels[name].pwm.pwmFrequency(config.pwmFrequencyHz);
    wheels[name].pwm.pwmWrite(0);
}

// konverzia percent na duty cycle pre pigpio 0-255
const pct = p => Math.round(Math.max(0, Math.min(100, p)) / 100 * 255);

function setWheel(name, in1, in2, pwmPct) {
    const w = wheels[name];
    w.in1.digitalWrite(in1);
    w.in2.digitalWrite(in2);
    w.pwm.pwmWrite(pct(pwmPct));
}

const getDefaultPwm = () => config.calibration.pwmTable?.[0]?.pwm ?? 30;

// matice smerov podla plan.md sekcia 4.2
function ahead(p = getDefaultPwm()) {
    const t = config.calibration.trimOffset || 0;
    setWheel('upperLeft',  1, 0, p + t);
    setWheel('lowerLeft',  0, 1, p + t);
    setWheel('upperRight', 0, 1, p - t);
    setWheel('lowerRight', 1, 0, p - t);
}
function back(p = getDefaultPwm()) {
    const t = config.calibration.trimOffset || 0;
    setWheel('upperLeft',  0, 1, p + t);
    setWheel('lowerLeft',  1, 0, p + t);
    setWheel('upperRight', 1, 0, p - t);
    setWheel('lowerRight', 0, 1, p - t);
}
function left(p = getDefaultPwm()) {  // otocenie dolava, pivot okolo stredu
    setWheel('upperLeft',  1, 0, p);
    setWheel('lowerLeft',  0, 1, p);
    setWheel('upperRight', 1, 0, p);
    setWheel('lowerRight', 0, 1, p);
}
function right(p = getDefaultPwm()) { // otocenie doprava
    setWheel('upperLeft',  0, 1, p);
    setWheel('lowerLeft',  1, 0, p);
    setWheel('upperRight', 0, 1, p);
    setWheel('lowerRight', 1, 0, p);
}
function stop() {
    for (const name of Object.keys(wheels)) wheels[name].pwm.pwmWrite(0);
}

const ACTIONS = { ahead, back, left, right, stop };

module.exports = { ACTIONS, stop };
