from __future__ import annotations

import gc
import re
import threading
import time
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from . import flagtypes, limits, winapi
from .flagtypes import Codec
from .offsets import EMPTY_TABLE, SOURCE_HOST, OffsetSource, OffsetTable

ROBLOX_IMAGE = b"RobloxPlayerBeta.exe"

MONITOR_INTERVAL = 20.0
WATCHDOG_INTERVAL = 5.0
BUILD_RE = re.compile(r"version-[0-9a-fA-F]{16}")

MAX_VALUE_BYTES = 64

STRING_OBJECT_BYTES = 32
STRING_WRITE_SPAN = 24
SSO_CAPACITY = 15
MAX_STRING_CAPACITY = 1 << 20

MONITOR_GIVE_UP = 6

CHUNK_PAUSE = 0.006

WARN_LIMIT = 3

WIPE_GIVE_UP_AFTER = 25
CLAMP_REPORT_LIMIT = 8

ProgressFn = Callable[[int, int, int, int], None]

class Target:

    __slots__ = ("address", "rva", "codec", "room", "section")

    def __init__(self, address: int, rva: int, codec: Codec, room: int, section: str):
        self.address = address
        self.rva = rva
        self.codec = codec
        self.room = room
        self.section = section

class Applied:

    __slots__ = ("address", "codec", "value", "written_at", "probe_at", "probe", "fights")

    def __init__(self, address: int, codec: Codec, value: Any, probe_at: int, probe: bytes):
        self.address = address
        self.codec = codec
        self.value = value
        self.written_at = time.time()
        self.probe_at = probe_at
        self.probe = probe
        self.fights = 0

class Session:
    def __init__(self, protocol, source: Optional[OffsetSource] = None):
        self.proto = protocol
        self.source = source or OffsetSource(log=protocol.log)

        self.handle: Optional[winapi.ProcessHandle] = None
        self.pid: Optional[int] = None
        self.base = 0
        self.image_size = 0
        self.table: OffsetTable = EMPTY_TABLE
        self.sections: List[winapi.Section] = []
        self.build_matched: Optional[bool] = None
        self.build_checkable = False
        self.client_build = ""
        self.client_path = ""

        self.applied: Dict[str, Applied] = {}
        self.original: Dict[str, List[Tuple[int, bytes]]] = {}
        self._resolved: Dict[str, Optional[Target]] = {}
        self._owner: Dict[int, str] = {}

        self.fuzzy = False
        self.guard = True
        self.limits = True
        self.reinjections = 0
        self.blocked: Dict[str, int] = {}
        self._warned: Dict[str, int] = {}
        self.abort = threading.Event()
        self.on_lost: Optional[Callable[[], None]] = None

        self.monitor_armed = False
        self.monitor_interval = MONITOR_INTERVAL

        self._lock = threading.RLock()
        self._monitor_stop: Optional[threading.Event] = None
        self._monitor_thread: Optional[threading.Thread] = None
        self._watchdog_stop: Optional[threading.Event] = None

    @property
    def connected(self) -> bool:
        return self.handle is not None and self.handle.alive

    @property
    def monitoring(self) -> bool:
        return self._monitor_thread is not None and self._monitor_thread.is_alive()

    def snapshot(self, flags_loaded: int = 0) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "pid": self.pid,
            "offsets": len(self.table),
            "injected": len(self.applied),
            "reinjections": self.reinjections,
            "monitoring": self.monitoring,
            "monitorArmed": self.monitor_armed,
            "monitorInterval": self.monitor_interval,
            "version": self.table.version,
            "clientBuild": self.client_build,
            "flags": flags_loaded,
            "fuzzy": self.fuzzy,
            "guard": self.guard,
            "limits": self.limits,
            "buildMatch": self.build_matched,
            "buildCheckable": self.build_checkable,
            "blocked": sum(self.blocked.values()),
        }

    def attach(self) -> bool:
        log = self.proto.log
        log("[*] Looking for Roblox...", "info")
        pid = winapi.find_process(ROBLOX_IMAGE)
        if not pid:
            log("[-] Roblox is not running", "error")
            return False
        log("[+] Found RobloxPlayerBeta.exe (PID %d)" % pid, "success")

        handle = winapi.ProcessHandle.open(pid)
        if handle is None:
            log("[-] Could not open the process - run as Administrator", "error")
            return False

        base, image_size = 0, 0
        for _ in range(5):
            base, image_size = winapi.module_bounds(pid)
            if base:
                break
            time.sleep(0.3)
        if not base:
            handle.close()
            log("[-] Could not resolve the module base address", "error")
            return False

        path = self._client_path(pid)
        running = BUILD_RE.search(path).group(0) if path and BUILD_RE.search(path) else ""
        if path:
            log("[+] Client image %s" % path, "info")
        else:
            log("[!] Could not read the client's path - its build cannot be checked", "warning")
        if path and not running:
            log("[!] That path has no version-<hash> folder in it, so the build is unknown", "warning")
        if running:
            log("[+] Client build %s" % running, "info")

        age = self.source.cached_age
        if age is not None and age < 3600:
            log("[*] Using cached offsets (%ds old)" % int(age), "info")
        else:
            log("[*] Fetching offsets...", "info")
        table = self.source.load()

        if table and running and self._build_differs(table, running):
            log(
                "[*] Roblox updated - cached offsets are %s, refetching for %s"
                % (table.version, running), "warning",
            )
            fresh = self.source.load(force=True)
            if fresh:
                table = fresh
            if self._build_differs(table, running):
                log(
                    "[!] %s has not dumped %s yet - the offsets are still for %s"
                    % (SOURCE_HOST, running, table.version), "warning",
                )
            else:
                log("[+] Got fresh offsets for %s" % running, "success")

        if not table:
            handle.close()
            return False

        sections = winapi.image_sections(handle, base)

        with self._lock:
            self.handle, self.pid = handle, pid
            self.base, self.image_size = base, image_size
            self.table = table
            self.sections = sections
            self.client_path = path
            self.client_build = running
            self.applied.clear()
            self.original.clear()
            self._resolved.clear()
            self._owner.clear()
            self.blocked.clear()
            self.reinjections = 0
            self.abort.clear()

        log("[+] Base 0x%X, image 0x%X" % (base, image_size), "info")
        log("[+] Loaded %s offsets for %s" % (format(len(table), ","), table.version or "unknown build"), "success")
        if sections:
            data = [section.name for section in sections if section.writable_data]
            log("[+] Mapped %d sections - writes confined to %s" % (len(sections), ", ".join(data) or "none"), "info")
        else:
            log("[!] Could not read the client's section table - the code-section guard is off", "warning")
        self._check_build()
        self._start_watchdog()
        if self.resume_monitor():
            log("[*] Live Monitor was waiting - it is running now, press Save config to write your list in", "info")
        return True

    @staticmethod
    def _client_path(pid: Optional[int]) -> str:
        try:
            return (winapi.image_path(pid) if pid else "") or ""
        except Exception:
            return ""

    @classmethod
    def _running_build(cls, pid: Optional[int]) -> str:
        path = cls._client_path(pid)
        if not path:
            return ""
        found = BUILD_RE.search(path)
        return found.group(0) if found else ""

    @staticmethod
    def _build_differs(table: OffsetTable, running: str) -> bool:
        if not running or not table or not table.version.startswith("version-"):
            return False
        return table.version.lower() != running.lower()

    def _check_build(self) -> None:
        self.build_matched = None
        try:
            running = self._running_build(self.pid)
            self.client_build = running
            self.build_checkable = self.table.version.startswith("version-")
            if not self.build_checkable:
                self.proto.log(
                    "[!] The offsets do not say which build they are for - the build check is off",
                    "warning",
                )
                return
            if not running:
                self.proto.log(
                    "[!] Could not read the client's build, so there is no way to tell whether the "
                    "offsets (%s) match it" % self.table.version, "warning",
                )
                self.proto.log(
                    "[!] Safe writes will refuse to inject while the build is unknown - run the app "
                    "as Administrator and Attach again",
                    "warning",
                )
                return
            self.build_matched = running.lower() == self.table.version.lower()
            if self.build_matched:
                self.proto.log("[+] Client build matches the offsets (%s)" % running, "success")
            else:
                self.proto.log(
                    "[!] BUILD MISMATCH - Roblox is %s but the offsets are for %s"
                    % (running, self.table.version), "warning",
                )
                self.proto.log(
                    "[!] Every address in the table is for a different build. Injecting now is what "
                    "crashes the client - turn Safe writes off only if you accept that",
                    "warning",
                )
                self.proto.log(
                    "[*] %s only has %s right now. Wait for it to dump %s and Attach again, or pin "
                    "Roblox to %s with a strap so it cannot update away from the offsets"
                    % (SOURCE_HOST, self.table.version, running, self.table.version), "info",
                )
        except Exception:
            pass

    def detach(self, reason: str = "", restore: bool = True) -> Dict[str, Any]:
        summary = {"restored": 0, "failed": 0, "touched": 0, "residue": 0, "names": []}
        self.stop_monitor()
        if restore and self.connected and (self.original or self.applied):
            summary = self.wipe(use_defaults=True, resume=False)
        self._stop_watchdog()
        with self._lock:
            if self.handle:
                self.handle.close()
            self.handle = None
            self.pid = None
            self.base = 0
            self.image_size = 0
            self.sections = []
            self.build_matched = None
            self.build_checkable = False
            self.client_build = ""
            self.client_path = ""
            self.applied.clear()
            self.original.clear()
            self._resolved.clear()
            self._owner.clear()
            self.blocked.clear()
            self.abort.clear()
        if reason:
            self.proto.log(reason, "info")
        return summary

    def resolve(self, name: str) -> Optional[Target]:
        cached = self._resolved.get(name, False)
        if cached is not False:
            return cached

        target = self._resolve_uncached(name)
        self._resolved[name] = target
        return target

    def forget_resolutions(self) -> None:
        with self._lock:
            self._resolved.clear()

    def _resolve_uncached(self, name: str) -> Optional[Target]:
        codec, bare = flagtypes.resolve(name)
        rva = self.table.lookup(bare, name)
        if not rva and self.fuzzy:
            guess = self.table.closest(bare, name)
            if guess:
                rva = self.table.values.get(guess, 0)
                if rva:
                    self.proto.log('[~] "%s" not found - using closest match "%s"' % (name, guess), "warning")

        address = self._address_of(rva)
        if not address:
            return None

        section = self._section_of(rva)
        if section is None:
            if self.sections and self.guard:
                self._block("section", '"%s" resolves outside every section of the client' % name)
                return None
            section_name = "?"
        else:
            if not section.writable_data and self.guard:
                self._block("section", '"%s" resolves into %s, a code section' % (name, section.name))
                return None
            section_name = section.name

        return Target(address, rva, codec, self.table.room_after(rva), section_name)

    def _section_of(self, rva: int) -> Optional[winapi.Section]:
        for section in self.sections:
            if section.start <= rva < section.end:
                return section
        return None

    def _address_of(self, rva: int) -> int:
        if not rva or not self.base or rva > 0x7FFFFFFF:
            return 0
        if self.image_size and rva >= self.image_size:
            return 0
        address = self.base + rva
        return address if winapi.in_user_space(address) else 0

    def apply(self, name: str, value: Any) -> bool:
        if not self.connected:
            return False
        target = self.resolve(name)
        if target is None:
            return False

        kind, payload = flagtypes.classify(target.codec, value)
        if payload is None:
            self._block("value", '"%s" has no legal value for a %s flag' % (name, target.codec.kind))
            return False

        if self.guard and not self._fits(name, target, kind, payload):
            return False

        owner = self._owner.get(target.address)
        if owner is not None and owner != name:
            self._block("collision", '"%s" resolves to the same address as "%s"' % (name, owner))
            return False

        plan = self._plan(target, kind, payload)
        if plan is None:
            self._block("layout", '"%s" does not look like a %s in memory' % (name, kind))
            return False
        writes, probe_at, probe = plan

        if name not in self.original:
            undo: List[Tuple[int, bytes]] = []
            for address, blob in writes:
                previous = self.handle.read(address, len(blob))
                if previous is None:
                    self._block("unreadable", '"%s" could not be read before writing' % name)
                    return False
                undo.append((address, previous))
            self.original[name] = undo

        for address, blob in writes:
            if not self.handle.write(address, blob):
                return False

        with self._lock:
            self.applied[name] = Applied(target.address, target.codec, value, probe_at, probe)
            self._owner[target.address] = name
        return True

    def _fits(self, name: str, target: Target, kind: str, payload: bytes) -> bool:
        room = min(target.room, MAX_VALUE_BYTES)

        if kind == "string":
            if room < STRING_WRITE_SPAN:
                self._block(
                    "room",
                    '"%s" is only %d bytes wide - too narrow to be a string flag' % (name, room),
                )
                return False
            return True

        if len(payload) > room:
            self._block(
                "room",
                '"%s" wants %d bytes but the build gives that flag %d' % (name, len(payload), room),
            )
            return False

        if kind == "bool":
            current = self.handle.read(target.address, 1)
            if current is not None and current[0] not in (0, 1):
                self._block(
                    "type",
                    '"%s" holds %d, which no boolean ever does (stale offsets?)' % (name, current[0]),
                )
                return False
        return True

    def _plan(self, target: Target, kind: str, payload: bytes):
        if kind != "string":
            return [(target.address, payload)], target.address, payload
        return self._plan_string(target, payload)

    def _plan_string(self, target: Target, payload: bytes):
        raw = self.handle.read(target.address, STRING_OBJECT_BYTES)
        if raw is None or len(raw) < STRING_OBJECT_BYTES:
            return None
        size = int.from_bytes(raw[16:24], "little")
        capacity = int.from_bytes(raw[24:32], "little")

        if capacity < SSO_CAPACITY or capacity > MAX_STRING_CAPACITY or size > capacity:
            return None

        text = payload[:-1]
        length = len(text)
        size_field = length.to_bytes(8, "little")

        if capacity == SSO_CAPACITY:
            if length > SSO_CAPACITY:
                return None
            buffer = text + b"\x00" * (16 - length)
            return (
                [(target.address, buffer), (target.address + 16, size_field)],
                target.address,
                buffer,
            )

        pointer = int.from_bytes(raw[0:8], "little")
        if length > capacity or not winapi.in_user_space(pointer, capacity + 1):
            return None
        return (
            [(pointer, payload), (target.address + 16, size_field)],
            pointer,
            payload,
        )

    def _block(self, reason: str, message: str) -> None:
        self.blocked[reason] = self.blocked.get(reason, 0) + 1
        seen = self._warned.get(reason, 0)
        if seen < WARN_LIMIT:
            self._warned[reason] = seen + 1
            self.proto.log("[!] %s - skipped" % message, "warning")

    def apply_many(
        self,
        flags: Dict[str, Any],
        progress: Optional[ProgressFn] = None,
        quiet: bool = False,
    ) -> Dict[str, int]:
        self.abort.clear()
        self.blocked.clear()
        self._warned.clear()
        total_requested = len(flags)

        flags, clamped = limits.screen(flags, self.limits)
        if clamped and not quiet:
            self.proto.log(
                "[*] Sane limits pulled %s flag%s back from a value that %s:"
                % (format(len(clamped), ","), "" if len(clamped) == 1 else "s", "breaks the client"),
                "warning",
            )
            for note in clamped[:CLAMP_REPORT_LIMIT]:
                self.proto.log(
                    "    %s  %s -> %s  (%s)" % (note["name"], note["was"], format(note["now"], ","), note["why"]),
                    "info",
                )
            if len(clamped) > CLAMP_REPORT_LIMIT:
                self.proto.log("    ...and %s more" % format(len(clamped) - CLAMP_REPORT_LIMIT, ","), "info")

        if not quiet:
            self.proto.log("[*] Resolving %s flags..." % format(total_requested, ","), "info")
        work: List[Tuple[str, Any]] = []
        for name, value in flags.items():
            if self.abort.is_set():
                break
            if self.resolve(name) is not None:
                work.append((name, value))

        skipped = total_requested - len(work)
        if skipped > 0 and not quiet:
            self.proto.log("[*] %s flags have no offset on this build - skipping them" % format(skipped, ","), "warning")

        total = len(work)
        if total == 0:
            if not quiet:
                self.proto.log("[-] Nothing left to inject", "error")
            return {
                "total": 0, "success": 0, "failed": 0, "skipped": skipped,
                "aborted": False, "blocked": {}, "clamped": len(clamped),
            }

        chunk = max(75, min(250, total // 40 or 75))
        if not quiet:
            self.proto.log("[*] Injecting %s flags..." % format(total, ","), "info")

        done = ok = failed = 0
        for start in range(0, total, chunk):
            if self.abort.is_set():
                break
            for name, value in work[start:start + chunk]:
                if self.abort.is_set():
                    break
                try:
                    succeeded = self.apply(name, value)
                except Exception:
                    succeeded = False
                done += 1
                if succeeded:
                    ok += 1
                else:
                    failed += 1
                if progress:
                    progress(done, total, ok, failed)
            gc.collect(0)
            if start + chunk < total:
                time.sleep(CHUNK_PAUSE)

        aborted = self.abort.is_set()
        rate = (ok / total * 100) if total else 0.0
        if quiet:
            pass
        elif aborted:
            self.proto.log("[!] Stopped early - %s of %s applied" % (format(ok, ","), format(total, ",")), "warning")
        else:
            self.proto.log(
                "[+] Done - %s of %s applied (%.1f%%), %s failed"
                % (format(ok, ","), format(total, ","), rate, format(failed, ",")),
                "success" if failed == 0 else "info",
            )
        if not quiet:
            self._report_blocked()
        return {
            "total": total, "success": ok, "failed": failed,
            "skipped": skipped, "aborted": aborted, "blocked": dict(self.blocked),
            "clamped": len(clamped),
        }

    def _report_blocked(self) -> None:
        if not self.blocked:
            return
        wording = {
            "room": "would have overwritten the flag next to them",
            "type": "held a value their type cannot hold",
            "section": "resolved into the client's code",
            "collision": "resolved onto an address another flag already owns",
            "layout": "did not match their type's layout in memory",
            "unreadable": "could not be read back, so could not be undone",
            "value": "had a value that flag type cannot represent",
        }
        total = sum(self.blocked.values())
        self.proto.log(
            "[*] Safe writes stopped %s flag%s that would have corrupted the client:"
            % (format(total, ","), "" if total == 1 else "s"),
            "info",
        )
        for reason, count in sorted(self.blocked.items(), key=lambda item: -item[1]):
            self.proto.log(
                "    %s %s" % (format(count, ",").rjust(7), wording.get(reason, reason)),
                "info",
            )

    def _undo_for(self, name: str, use_defaults: bool) -> Optional[List[Tuple[int, bytes]]]:
        undo = self.original.get(name)
        if undo:
            return undo
        entry = self.applied.get(name)
        if entry is None or not use_defaults or entry.codec.kind in ("string", "auto"):
            return None
        return [(entry.address, entry.codec.default)]

    def _write_back(self, undo: List[Tuple[int, bytes]]) -> bool:
        ok = True
        for address, blob in reversed(undo):
            try:
                if not self.handle.write(address, blob):
                    ok = False
            except Exception:
                ok = False
        return ok

    def _settled(self, undo: List[Tuple[int, bytes]]) -> bool:
        for address, blob in undo:
            try:
                if self.handle.read(address, len(blob)) != blob:
                    return False
            except Exception:
                return False
        return True

    def wipe(self, use_defaults: bool = True, resume: bool = True) -> Dict[str, Any]:
        blank = {"restored": 0, "failed": 0, "touched": 0, "residue": 0, "names": []}
        if not self.connected:
            return blank

        self.abort.set()
        self.stop_monitor()

        with self._lock:
            names = list(self.original.keys())
            names.extend(name for name in self.applied if name not in self.original)
            plans = [(name, self._undo_for(name, use_defaults)) for name in names]

        ok = failed = 0
        streak = 0
        residue: List[str] = []
        gone = False

        for name, undo in plans:
            if undo is None:
                failed += 1
                residue.append(name)
                continue
            if gone:
                failed += 1
                residue.append(name)
                continue

            self._write_back(undo)
            if not self._settled(undo):
                self._write_back(undo)

            if self._settled(undo):
                ok += 1
                streak = 0
            else:
                failed += 1
                residue.append(name)
                streak += 1
                if streak >= WIPE_GIVE_UP_AFTER:
                    gone = True
                    self.proto.log(
                        "[-] The client stopped answering writes - it is closing or already gone",
                        "error",
                    )

        with self._lock:
            self.applied.clear()
            self.original.clear()
            self._resolved.clear()
            self._owner.clear()
            self.blocked.clear()
            self.reinjections = 0
            self.abort.clear()

        if resume:
            self.resume_monitor()

        return {
            "restored": ok, "failed": failed, "touched": len(plans),
            "residue": len(residue), "names": residue[:20],
        }

    def revert(self, names: Iterable[str], use_defaults: bool = True) -> Dict[str, Any]:
        summary = {"reverted": 0, "failed": 0, "touched": 0, "names": []}
        if not self.connected:
            return summary

        for name in list(names):
            with self._lock:
                if name not in self.original and name not in self.applied:
                    continue
                undo = self._undo_for(name, use_defaults)
                entry = self.applied.get(name)

            summary["touched"] += 1
            settled = False
            if undo is not None:
                self._write_back(undo)
                if not self._settled(undo):
                    self._write_back(undo)
                settled = self._settled(undo)

            with self._lock:
                self.applied.pop(name, None)
                self.original.pop(name, None)
                self._resolved.pop(name, None)
                if entry is not None and self._owner.get(entry.address) == name:
                    self._owner.pop(entry.address, None)

            if settled:
                summary["reverted"] += 1
            else:
                summary["failed"] += 1
                if len(summary["names"]) < 20:
                    summary["names"].append(name)

        return summary

    def set_monitor(self, on: bool, interval: Optional[float] = None) -> bool:
        moved = False
        if interval:
            value = max(5.0, min(120.0, float(interval)))
            moved = value != self.monitor_interval
            self.monitor_interval = value

        self.monitor_armed = bool(on)
        if not self.monitor_armed:
            self.stop_monitor()
            return False
        if moved and self.monitoring:
            self.stop_monitor()
        return self.resume_monitor()

    def resume_monitor(self) -> bool:
        if not self.monitor_armed or self.monitoring or not self.connected:
            return False
        stop = threading.Event()
        thread = threading.Thread(
            target=self._monitor_loop, args=(self.monitor_interval, stop), daemon=True,
        )
        self._monitor_stop, self._monitor_thread = stop, thread
        thread.start()
        self.proto.log("[+] Monitor on - rechecking every %ds" % int(self.monitor_interval), "success")
        return True

    def stop_monitor(self) -> None:
        if self._monitor_stop:
            self._monitor_stop.set()
        thread = self._monitor_thread
        if thread and thread.is_alive():
            thread.join(timeout=2)
        self._monitor_stop = self._monitor_thread = None

    def _monitor_loop(self, interval: float, stop: threading.Event) -> None:
        while not stop.is_set():
            with self._lock:
                entries = list(self.applied.items())
            if entries:
                pace = max(0.0005, min(0.05, interval / (len(entries) * 2)))
                for name, entry in entries:
                    if stop.is_set():
                        break
                    self._verify(name, entry)
                    stop.wait(pace)
            stop.wait(max(1.0, interval - len(entries) * 0.001))

    def _verify(self, name: str, entry: Applied) -> None:
        if entry.fights >= MONITOR_GIVE_UP:
            return
        try:
            current = self.handle.read(entry.probe_at, len(entry.probe)) if self.handle else None
            if current is None or current == entry.probe:
                return
            if self.handle.write(entry.probe_at, entry.probe):
                self.reinjections += 1
                entry.fights += 1
                if entry.fights == MONITOR_GIVE_UP:
                    self.proto.log(
                        '[*] "%s" keeps being rewritten by the client - leaving it alone' % name,
                        "info",
                    )
        except Exception:
            pass

    def _start_watchdog(self) -> None:
        self._stop_watchdog()
        stop = threading.Event()
        self._watchdog_stop = stop
        threading.Thread(target=self._watchdog_loop, args=(stop,), daemon=True).start()

    def _stop_watchdog(self) -> None:
        if self._watchdog_stop:
            self._watchdog_stop.set()
        self._watchdog_stop = None

    def _watchdog_loop(self, stop: threading.Event) -> None:
        while not stop.wait(WATCHDOG_INTERVAL):
            if not self.connected:
                return
            if self.handle.read(self.base, 4) is not None:
                continue
            self.proto.log("[-] Roblox closed - session ended", "error")
            self.detach(restore=False)
            if self.on_lost:
                try:
                    self.on_lost()
                except Exception:
                    pass
            return
