import os, ssl, json, re, socket, urllib.request, urllib.parse, http.server

DIR = os.path.dirname(os.path.abspath(__file__))
DEMO = "eating-detector-demo.html"
CERT = os.path.join(DIR, "cert.pem")
KEY = os.path.join(DIR, "key.pem")
AMAP_KEY = "0e7f3779aeaa9ee9ce6e5e7dc97ee4a5"  # 高德 Web服务 key（仅服务端，不进网页）
HOST = "0.0.0.0"
PORT = 8443

os.chdir(DIR)


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def amap_regeo(lat, lng):
    q = urllib.parse.urlencode({
        "location": "{},{}".format(lng, lat),
        "key": AMAP_KEY,
        "coordsys": "wgs84",
        "extensions": "all",
        "poitype": "050000",
        "radius": "200",
        "sortrule": "distance",
        "output": "JSON",
    })
    req = urllib.request.Request("https://restapi.amap.com/v3/geocode/regeo?" + q,
                                 headers={"User-Agent": "eating-demo/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        d = json.loads(resp.read().decode("utf-8"))
    if d.get("status") != "1":
        return {"loc": "other", "addr": "", "error": d.get("info", "amap error")}
    r = d.get("regeocode", {}) or {}
    addr = r.get("formatted_address", "") or ""
    ac = r.get("addressComponent", {}) or {}
    pois = r.get("pois") or []
    nearest = None; nearestName = ""
    for p in pois:
        try: dd = float(p.get("distance") or 9999)
        except Exception: dd = 9999.0
        if nearest is None or dd < nearest:
            nearest = dd; nearestName = p.get("name", "")
    txt = addr + " " + str(ac.get("township", "")) + " " + json.dumps(ac.get("businessAreas", ""), ensure_ascii=False)
    if nearest is not None and nearest <= 80:
        loc = "restaurant"
    elif re.search(r"公司|办公|写字楼|商务|大厦|科技园|产业园|孵化器", txt):
        loc = "office"
    elif re.search(r"小区|公寓|住宅|家园|苑|花园|村", txt):
        loc = "home"
    elif nearest is not None and nearest <= 200:
        loc = "cafe"
    else:
        loc = "other"
    return {"loc": loc, "addr": addr, "nearestFood": nearestName, "nearestDist": nearest}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/regeo":
            self._regeo(parsed.query)
        elif parsed.path in ("/", "/" + DEMO):
            self.path = "/" + DEMO
            super().do_GET()
        else:
            self.send_error(403, "Forbidden")
    def _regeo(self, query):
        p = urllib.parse.parse_qs(query)
        try:
            lat = float(p["lat"][0]); lng = float(p["lng"][0])
            res = amap_regeo(lat, lng)
        except Exception as e:
            res = {"loc": "other", "addr": "", "error": str(e)}
        body = json.dumps(res, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass


sslctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
sslctx.load_cert_chain(CERT, KEY)
httpd = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
httpd.socket = sslctx.wrap_socket(httpd.socket, server_side=True)

ip = lan_ip()
print("lan https on {}:{}  (localhost: {})".format(ip, PORT, PORT))
print("phone URL: https://{}:{}/".format(ip, PORT))
print("cert is self-signed -> 首次打开点『高级 / 显示详情 → 仍要访问』")
httpd.serve_forever()
