from __future__ import annotations

import json
import math
import re
import shutil
import time
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "static"
UPLOAD = ROOT / "uploads"
HISTORY = ROOT / "history.json"
MAX_SIZE = 50 * 1024 * 1024 #最大尺寸字节数


def read_history():
    try:
        return json.loads(HISTORY.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def write_history(items):
    HISTORY.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def add_history(folder: Path, name: str):
    path = str(folder)
    items = read_history()
    old = next((x for x in items if x.get("path") == path), None)
    items = [x for x in items if x.get("path") != path]
    item = old or {"id": str(int(time.time() * 1000)), "name": Path(name).stem or name,
                   "path": path}
    item["time"] = time.strftime("%Y-%m-%d %H:%M:%S")
    items.insert(0, item)
    for old in items[5:]:
        old_path = Path(old.get("path", ""))
        if UPLOAD in old_path.parents:
            shutil.rmtree(old_path, ignore_errors=True)
    write_history(items[:5])
    return item
def get_dir(path: str | None) -> Path:
    if not path:
        raise ValueError("请先输入结果目录或上传日志文件")
    folder = Path(path).expanduser()
    if not folder.is_absolute():
        folder = ROOT / folder
    folder = folder.resolve()
    if not folder.is_dir():
        raise ValueError("目录不存在或不可访问")
    return folder


def read_rows(file: Path) -> list[list[float]]:
    rows: list[list[float]] = []
    try:
        with file.open("r", encoding="utf-8", errors="replace") as source:
            for line in source:
                line = line.strip()
                if not line or line.startswith(("#", "//", ";")):
                    continue
                try:
                    values = [float(v) for v in re.split(r"[\s,;]+", line)]
                except ValueError:
                    continue
                if len(values) >= 2 and all(math.isfinite(v) for v in values):
                    rows.append(values)
    except OSError:
        return []
    return rows


def scan_log(root: Path) -> tuple[Path | None, list[list[float]]]:
    candidates = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in {"", ".log", ".out", ".dat", ".txt", ".csv"}]
    best: tuple[Path | None, list[list[float]]] = (None, [])
    for file in candidates:
        if "droplet_intermediate" in file.parts or "snapshot" in file.parts:
            continue
        rows = read_rows(file)
        if len(rows) > len(best[1]) and len(rows) >= 2:
            best = (file, rows)
    return best


def read_facets(file: Path) -> list[list[float]]:
    segs, pts = [], []
    for row in read_rows(file):
        if len(row) >= 4:
            segs.append(row[:4])
        elif len(row) >= 2:
            pts.append(row[:2])
    for a, b in zip(pts[::2], pts[1::2]):
        segs.append([a[0], a[1], b[0], b[1]])
    return segs


def facet_index(root: Path) -> list[dict]:
    folder = root / "droplet_intermediate"
    if not folder.is_dir():
        return []
    frames = []
    for file in folder.glob("*"):
        match = re.search(r"(?:^|_)t(-?\d+(?:\.\d+)?)(?:\.dat)?$", file.name)
        if file.is_file() and match:
            frames.append({"t": float(match.group(1)), "file": file})
    return sorted(frames, key=lambda frame: frame["t"])


def facet_range(frames) -> list[float] | None:
    xs, ys = [], []
    for frame in frames:
        for x1, y1, x2, y2 in read_facets(frame["file"]):
            xs.extend((x1, x2))
            ys.extend((y1, y2))
    if not xs:
        return None
    return [min(xs), max(xs), min(ys), max(ys)]


def project_summary(root: Path) -> dict:
    log_file, rows = scan_log(root)
    width = max((len(row) for row in rows), default=0)
    columns = [(f"col_{i+1}", "") for i in range(width)]
    frames = facet_index(root)
    return {
        "path": str(root), "name": root.name, "logFile": str(log_file) if log_file else None,
        "rowCount": len(rows), "columns": [{"id": a, "label": b} for a, b in columns],
        "timeRange": [rows[0][0], rows[-1][0]] if rows else None,
        "facetTimes": [frame["t"] for frame in frames], "facetRange": facet_range(frames),
    }


# 校验上传日志文件是否合规
def read_upload(handler):
    size = int(handler.headers.get("Content-Length", "0"))
    if not 0 < size <= MAX_SIZE:
        raise ValueError("请选择不超过 50 MB 的日志文件")
    kind = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in kind:
        raise ValueError("上传格式不正确")
    raw = handler.rfile.read(size)
    msg = BytesParser(policy=default).parsebytes(
        f"Content-Type: {kind}\r\nMIME-Version: 1.0\r\n\r\n".encode() + raw
    )
    files = [(Path(x.get_filename()).name, x.get_payload(decode=True) or b"")
             for x in msg.iter_parts() if x.get_filename()]
    if not files:
        raise ValueError("没有读取到日志文件")
    return files


def save_upload(handler) -> dict:
    name, data = read_upload(handler)[0]
    if not data:
        raise ValueError("上传文件为空")
    folder = UPLOAD / f"log_{int(time.time() * 1000)}"
    folder.mkdir(parents=True, exist_ok=False)
    (folder / name).write_bytes(data)
    item = add_history(folder, name)
    return {"path": str(folder), "name": name, "history": item}


def save_facets(handler, root: Path) -> dict:
    files = read_upload(handler)
    folder = root / "droplet_intermediate"
    folder.mkdir(parents=True, exist_ok=True)
    count = 0
    for name, data in files:
        file = Path(name)
        if file.suffix.lower() != ".dat" or not data:
            continue
        (folder / file.name).write_bytes(data)
        count += 1
    if not count:
        raise ValueError("请选择至少一个非空的 .dat 轮廓文件")
    return {"count": count, "path": str(root)}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed)
            return
        self.path = "/index.html" if parsed.path == "/" else parsed.path
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/upload", "/api/upload/facets", "/api/history/rename"}:
            self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
            return
        try:
            if parsed.path == "/api/history/rename":
                size = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(size))
                items = read_history()
                item = next((x for x in items if x["id"] == data.get("id")), None)
                name = str(data.get("name", "")).strip()
                if not item or not name:
                    raise ValueError("工况名称不能为空")
                item["name"] = name[:50]
                write_history(items)
                data = item
            elif parsed.path == "/api/upload":
                data = save_upload(self)
            else:
                path = parse_qs(parsed.query).get("path", [None])[0]
                data = save_facets(self, get_dir(path))
            self.send_json(data, HTTPStatus.CREATED)
        except (ValueError, OSError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:
            self.send_json({"error": f"上传处理出错：{error}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def translate_path(self, path: str) -> str:
        relative = unquote(urlparse(path).path).lstrip("/")
        return str(WEB / relative)

    def send_json(self, payload: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, parsed) -> None:
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/history":
                self.send_json({"items": read_history()}); return
            root = get_dir(query.get("path", [None])[0])
            if parsed.path == "/api/project":
                data = project_summary(root)
                if data["rowCount"]:
                    add_history(root, root.name)
                self.send_json(data); return
            if parsed.path == "/api/curve":
                _, rows = scan_log(root)
                column = int(query.get("column", ["6"])[0])
                if column < 0 or any(len(row) <= column for row in rows):
                    raise ValueError("请求的日志列不存在")
                self.send_json({"points": [[row[0], row[column]] for row in rows]}); return
            if parsed.path == "/api/facet":
                frames = facet_index(root)
                if not frames:
                    self.send_json({"actualTime": None, "segments": []}); return
                wanted = float(query.get("t", [str(frames[0]["t"])])[0])
                frame = min(frames, key=lambda item: abs(item["t"] - wanted))
                self.send_json({"actualTime": frame["t"], "segments": read_facets(frame["file"])}); return
            self.send_json({"error": "接口不存在"}, HTTPStatus.NOT_FOUND)
        except (ValueError, OSError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("BSPV system is running at http://127.0.0.1:8000")
    print("Press Ctrl+C to stop.")
    server.serve_forever()
