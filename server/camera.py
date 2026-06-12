#!/usr/bin/env python3
import io, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = threading.Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()

class StreamingHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # potlacit logy pristupu

    def do_GET(self):
        if self.path == '/snapshot':
            with output.condition:
                output.condition.wait(timeout=2)
                frame = output.frame
            if frame is None:
                self.send_response(503); self.end_headers(); return
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(frame)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(frame)
            return

        self.send_response(200)
        self.send_header('Age', '0')
        self.send_header('Cache-Control', 'no-cache, private')
        self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        self.end_headers()
        try:
            while True:
                with output.condition:
                    output.condition.wait()
                    frame = output.frame
                self.wfile.write(
                    b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
                )
        except Exception:
            pass

output = StreamingOutput()
picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
picam2.start_recording(MJPEGEncoder(), FileOutput(output))

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

print("kamera streamuje na :8081")
server = ThreadedHTTPServer(('0.0.0.0', 8081), StreamingHandler)
server.serve_forever()
