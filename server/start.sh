#!/bin/bash
echo "=== Starting Robot-Pi server ==="
sudo killall node 2>/dev/null
sudo killall python3 2>/dev/null
sudo killall pigpiod 2>/dev/null
sudo rm -f /var/run/pigpio.pid
sleep 1
cd /home/pi/robot
python3 server/camera.py >> /tmp/camera.log 2>&1 &
sudo node server/index.js >> /tmp/robot.log 2>&1 &
echo "=== Started ==="