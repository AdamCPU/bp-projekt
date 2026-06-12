#!/bin/bash
echo "=== Stopping Robot-Pi server ==="
sudo killall node 2>/dev/null
sudo killall python3 2>/dev/null
sudo killall pigpiod 2>/dev/null
sudo rm -f /var/run/pigpio.pid
echo "=== Stopped ==="
