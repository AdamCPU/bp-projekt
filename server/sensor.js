// ultrazvukovy senzor HC-SR04 cez pigpio
// TRIG pin posiela kratky impuls 10us pre spustenie merania
// ECHO pin - dlzka impulzu deleno 58 da vzdialenost v cm

const { Gpio } = require('pigpio');
const config   = require('./config.json');

const { trigPin, echoPin, intervalMs } = config.ultrasonic;

const trig = new Gpio(trigPin, { mode: Gpio.OUTPUT });
const echo = new Gpio(echoPin, { mode: Gpio.INPUT, alert: true });

trig.digitalWrite(0);

let startTick  = null;
let lastCm     = null;
let intervalId = null;
let onChange   = null;

echo.on('alert', (level, tick) => {
    if (level === 1) {
        startTick = tick;
    } else if (level === 0 && startTick !== null) {
        let diff = (tick - startTick) >>> 0;
        const cm = Math.round(diff / 58 * 10) / 10;
        if (cm >= 2 && cm < 400) {
            lastCm = cm;
            if (onChange) onChange(lastCm);
        }
        startTick = null;
    }
});

function start(callback) {
    onChange = callback;
    intervalId = setInterval(() => trig.trigger(10, 1), intervalMs);
}

function stop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    onChange = null;
}

function getLast() { return lastCm; }

module.exports = { start, stop, getLast };
