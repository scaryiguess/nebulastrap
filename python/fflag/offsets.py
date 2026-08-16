from __future__ import annotations

import bisect
import difflib
import json
import os
import re
import tempfile
import threading
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SOURCE_URL = "https://offsets.imtheo.lol/FFlags.hpp"
SOURCE_HOST = "offsets.imtheo.lol"
CACHE_SECONDS = 3600
FETCH_ATTEMPTS = 3
FETCH_TIMEOUT = 5

_NOT_FLAGS = frozenset({
    "Pointer", "ToFlag", "ToValue", "ClientVersion", "Singleton",
    "FFlagList", "ValueGetSet", "FlagToValue",
})

_ENTRY_RE = re.compile(r"uintptr_t\s+(\w+)\s*=\s*(0x[0-9A-Fa-f]+)")
_VERSION_RE = re.compile(r'ClientVersion\s*=\s*"([^"]+)"')

FUZZY_BUDGET = 3000
FUZZY_CUTOFF = 0.84

UNBOUNDED_ROOM = 1 << 30

class OffsetTable:

    __slots__ = ("values", "version", "_by_lower", "_fuzzy_left", "_sorted_rvas")

    def __init__(self, values: Dict[str, int], version: str = ""):
        self.values = values
        self.version = version
        self._by_lower = {name.lower(): name for name in values}
        self._fuzzy_left = FUZZY_BUDGET
        self._sorted_rvas: Optional[List[int]] = None

    def __len__(self) -> int:
        return len(self.values)

    def __bool__(self) -> bool:
        return bool(self.values)

    def lookup(self, *names: str) -> int:
        for name in names:
            rva = self.values.get(name, 0)
            if rva:
                return rva
        for name in names:
            canonical = self._by_lower.get(name.lower())
            if canonical:
                return self.values.get(canonical, 0)
        return 0

    def room_after(self, rva: int) -> int:
        if self._sorted_rvas is None:
            self._sorted_rvas = sorted(set(self.values.values()))
        index = bisect.bisect_right(self._sorted_rvas, rva)
        if index >= len(self._sorted_rvas):
            return UNBOUNDED_ROOM
        return self._sorted_rvas[index] - rva

    def closest(self, *names: str) -> Optional[str]:
        for name in names:
            if not name or len(name) < 5 or self._fuzzy_left <= 0:
                continue
            self._fuzzy_left -= 1
            hit = difflib.get_close_matches(
                name.lower(), self._by_lower.keys(), n=1, cutoff=FUZZY_CUTOFF
            )
            if hit:
                return self._by_lower[hit[0]]
        return None

EMPTY_TABLE = OffsetTable({}, "")

def parse_header(text: str) -> Tuple[Dict[str, int], str]:
    version_match = _VERSION_RE.search(text)
    version = version_match.group(1) if version_match else ""

    start = text.find("namespace FFlags {")
    if start == -1:
        raise ValueError("FFlags namespace not found")
    end = text.find("}", start + 100)
    section = text[start: end if end != -1 else len(text)]

    values = {}
    for name, hex_value in _ENTRY_RE.findall(section):
        if name in _NOT_FLAGS:
            continue
        rva = int(hex_value, 16)
        if rva > 0:
            values[name] = rva
    if not values:
        raise ValueError("no offsets in FFlags namespace")
    return values, version

class OffsetSource:

    def __init__(self, url: str = SOURCE_URL, log=None):
        self.url = url
        self._log = log or (lambda message, level="info": None)
        self._lock = threading.Lock()
        self._table: Optional[OffsetTable] = None
        self._fetched_at = 0.0
        root = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
        self._disk_path = Path(root) / "FFlagInjectorV3" / "offsets.json"

    @property
    def cached_age(self) -> Optional[float]:
        if self._table is None:
            return None
        return time.time() - self._fetched_at

    def _fresh(self) -> bool:
        return self._table is not None and (time.time() - self._fetched_at) < CACHE_SECONDS

    def _read_disk(self) -> Optional[OffsetTable]:
        try:
            with open(self._disk_path, "r", encoding="utf-8") as handle:
                saved = json.load(handle)
            values = saved.get("offsets")
            if isinstance(values, dict) and values:
                return OffsetTable({k: int(v) for k, v in values.items()}, saved.get("version", ""))
        except Exception:
            pass
        return None

    def _write_disk(self, table: OffsetTable) -> None:
        try:
            self._disk_path.parent.mkdir(parents=True, exist_ok=True)
            staging = self._disk_path.with_suffix(".tmp")
            with open(staging, "w", encoding="utf-8") as handle:
                json.dump({"offsets": table.values, "version": table.version}, handle)
            os.replace(staging, self._disk_path)
        except Exception:
            pass

    def _download(self) -> str:
        request = urllib.request.Request(
            self.url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/plain"}
        )
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
            if response.status != 200:
                raise IOError("HTTP %s" % response.status)
            body = response.read().decode("utf-8", errors="ignore")
        if len(body) < 100:
            raise ValueError("response too short to be the header")
        return body

    def load(self, force: bool = False) -> OffsetTable:
        if not force and self._fresh():
            return self._table

        with self._lock:
            if not force and self._fresh():
                return self._table

            failure = ""
            for attempt in range(FETCH_ATTEMPTS):
                try:
                    values, version = parse_header(self._download())
                except Exception as exc:
                    failure = str(exc)[:100]
                    if attempt < FETCH_ATTEMPTS - 1:
                        time.sleep(0.5 * (attempt + 1))
                    continue
                table = OffsetTable(values, version)
                self._table, self._fetched_at = table, time.time()
                self._write_disk(table)
                return table

            stale = self._read_disk()
            if stale:
                self._table, self._fetched_at = stale, time.time()
                self._log(
                    "[!] Offset fetch failed (%s) - using last-known-good offsets from disk (%s)"
                    % (failure, stale.version or "unknown build"),
                    "warning",
                )
                return stale

            self._log("[-] Could not load offsets: %s" % (failure or "unknown error"), "error")
            return EMPTY_TABLE

    def preload(self) -> None:
        threading.Thread(target=self._preload_quietly, daemon=True).start()

    def _preload_quietly(self) -> None:
        try:
            self.load(force=True)
        except Exception:
            pass
