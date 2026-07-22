import os, json, re, urllib.request, urllib.parse, urllib.error, http.server

DIR = os.path.dirname(os.path.abspath(__file__))
DEMO = "eating-detector-demo.html"
AMAP_KEY = "0e7f3779aeaa9ee9ce6e5e7dc97ee4a5"  # 高德 Web服务 key（仅服务端，不进网页）

# —— TAL 网关（OpenAI 兼容 /chat/completions；GPT5.5 内联音频判断）——
TAL_APP_ID = os.environ.get("TAL_MLOPS_APP_ID", "")
TAL_APP_KEY = os.environ.get("TAL_MLOPS_APP_KEY", "")
TAL_CHAT_URL = "http://ai-service.tal.com/openai-compatible/v1/chat/completions"
TAL_MODEL = "gpt-5.5"

JUDGE_SYS = (
    "你是进食状态判断助手。会收到一句浏览器语音识别转写出的文字（用户身边麦克风说的话）。"
    "判断说话人是否在表示「自己正在/刚开始/已经吃饭」。"
    "确认语包括但不限于：吃饭了、在吃饭、开饭了、我吃了、正在吃、吃饭、"
    "刚开吃、吃上了、饭来了 等同义说法；旁人闲聊、环境音、与吃饭无关的话不算。"
    "转写可能有错别字，按发音近似判断。"
    '只返回 JSON：{"matched":true/false,"phrase":"命中的确认语(无则空)","transcript":"输入文字原样回传"}'
)

os.chdir(DIR)


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


def judge_eating(transcript):
    if not (TAL_APP_ID and TAL_APP_KEY):
        return {"matched": False, "phrase": "", "transcript": transcript, "error": "gateway creds missing (TAL_MLOPS_APP_ID/KEY)"}
    payload = {
        "model": TAL_MODEL,
        "reasoning_effort": "low",
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": JUDGE_SYS},
            {"role": "user", "content": "判断这句话是否表示正在/刚开始/已经吃饭：" + transcript}
        ]
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(TAL_CHAT_URL, data=data, method="POST",
                                 headers={"Authorization": "Bearer " + TAL_APP_KEY,
                                          "api-key": TAL_APP_ID,
                                          "Content-Type": "application/json",
                                          "User-Agent": "eating-demo/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            d = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "ignore")
        return {"matched": False, "phrase": "", "transcript": transcript, "error": "gateway HTTP %d" % e.code, "detail": body[:300]}
    except Exception as e:
        return {"matched": False, "phrase": "", "transcript": transcript, "error": "gateway: " + str(e)}
    try:
        content = d["choices"][0]["message"]["content"]
    except Exception:
        return {"matched": False, "phrase": "", "transcript": transcript, "error": "bad gateway response", "raw": d}
    try:
        j = json.loads(content)
    except Exception:
        m = re.search(r'\{.*\}', content, re.S)
        j = json.loads(m.group(0)) if m else {}
    return {
        "matched": bool(j.get("matched")),
        "phrase": j.get("phrase", "") or "",
        "transcript": j.get("transcript", "") or transcript,
    }


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
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/eating-check":
            self._eating_check()
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
    def _eating_check(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode("utf-8")) if raw else {}
            transcript = (req.get("transcript") or "").strip()
            if not transcript:
                res = {"matched": False, "phrase": "", "transcript": "", "error": "empty transcript"}
            else:
                res = judge_eating(transcript)
        except Exception as e:
            res = {"matched": False, "phrase": "", "transcript": "", "error": "bad request: " + str(e)}
        body = json.dumps(res, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass


httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
print("locked-down http on 127.0.0.1:8080")
httpd.serve_forever()
