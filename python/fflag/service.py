from __future__ import annotations

import queue
import threading
import time
from typing import Any, Callable, Dict, Optional

from . import flagfile, flagtypes, macro, winapi
from .flagfile import load as load_flag_file
from .offsets import OffsetSource
from .protocol import Protocol
from .session import ROBLOX_IMAGE, Session
from .version import ENGINE_VERSION

PROGRESS_MIN_INTERVAL = 0.04
HEARTBEAT_INTERVAL = 2.0
SAMPLE_LIMIT = 500
AUTO_ATTACH_INTERVAL = 3.0
AUTO_ATTACH_TRIES = 3
AUTO_ATTACH_MIN_AGE = 30.0

class Service:
    def __init__(self, protocol: Optional[Protocol] = None):
        self.proto = protocol or Protocol()
        self.source = OffsetSource(log=self.proto.log)
        self.session = Session(self.proto, self.source)
        self.session.on_lost = self._on_process_lost

        self.flags: Dict[str, Any] = {}
        self.running = True

        self.recorder = macro.Recorder(log=self.proto.log)
        self.player = macro.Player(log=self.proto.log, on_finish=self._on_macro_finish)

        self._jobs: "queue.Queue[tuple]" = queue.Queue()
        self._busy: Optional[str] = None

        self.auto_attach = False
        self._auto_pid: Optional[int] = None
        self._auto_tries = 0
        self._auto_seen_at: Optional[float] = None
        self._auto_waited = False
        self._auto_wake = threading.Event()

        self.jobs: Dict[str, Callable] = {
            "attach": self._attach,
            "detach": self._detach,
            "load": self._load,
            "inject": self._inject,
            "sync": self._sync,
            "restore": self._restore,
            "revert": self._revert,
        }
        self.controls: Dict[str, Callable] = {
            "status": self._status,
            "settings": self._settings,
            "sample": self._sample,
            "clear": self._clear,
            "monitor": self._monitor,
            "cancel": self._cancel,
            "flag_set": self._flag_set,
            "flag_remove": self._flag_remove,
            "flags_replace": self._flags_replace,
            "flags_text": self._flags_text,
            "flags_all": self._flags_all,
            "parse": self._parse,
            "parse_text": self._parse_text,
            "suggest": self._suggest,
            "probe": self._probe,
            "macro_record": self._macro_record,
            "macro_play": self._macro_play,
            "macro_stop": self._macro_stop,
            "macro_state": self._macro_state,
            "macro_cursor": lambda args: macro.cursor_position(),
            "ping": lambda args: {"pong": time.time()},
            "quit": self._quit,
        }

    def run(self) -> None:
        threading.Thread(target=self._work, daemon=True).start()
        threading.Thread(target=self._heartbeat, daemon=True).start()
        threading.Thread(target=self._auto_attach_loop, daemon=True).start()
        self.source.preload()
        self.proto.event("ready", version=self.session.table.version, engine=ENGINE_VERSION)
        self.proto.log("[+] Engine ready", "success")

        for request in self.proto.requests():
            if not self.running:
                break
            self._dispatch(request)
        self.shutdown()

    def shutdown(self) -> None:
        self.running = False
        try:
            self.player.stop()
            self.recorder.stop()
        except Exception:
            pass
        try:
            self.session.detach(restore=True)
        except Exception:
            pass

    def _dispatch(self, request: Dict[str, Any]) -> None:
        request_id = request.get("id")
        op = request.get("op", "")
        args = request.get("args") or {}
        if not isinstance(args, dict):
            args = {}

        if op in self.controls:
            self._invoke(self.controls[op], request_id, op, args)
        elif op in self.jobs:
            if op in ("detach", "restore") and self._busy == "inject":
                self.session.abort.set()
                self.proto.log("[!] Stopping the injection first...", "warning")
            self._jobs.put((request_id, op, args))
        else:
            self.proto.reply(request_id, ok=False, error="unknown op: %s" % op)

    def _invoke(self, handler: Callable, request_id, op: str, args: Dict[str, Any]) -> None:
        try:
            result = handler(args) or {}
            self.proto.reply(request_id, ok=result.pop("ok", True), **result)
        except Exception as exc:
            self.proto.log("[-] %s failed: %s" % (op, str(exc)[:150]), "error")
            self.proto.reply(request_id, ok=False, error=str(exc)[:200])

    def _work(self) -> None:
        while self.running:
            try:
                request_id, op, args = self._jobs.get(timeout=0.5)
            except queue.Empty:
                continue
            self._busy = op
            try:
                self._invoke(self.jobs[op], request_id, op, args)
            finally:
                self._busy = None
                self._jobs.task_done()
                self._push_status()

    def _heartbeat(self) -> None:
        while self.running:
            time.sleep(HEARTBEAT_INTERVAL)
            if self.session.monitoring or self._busy:
                self._push_status()

    def _auto_attach_loop(self) -> None:
        while self.running:
            self._auto_wake.wait(AUTO_ATTACH_INTERVAL)
            self._auto_wake.clear()
            if not self.running or not self.auto_attach:
                continue
            if self.session.connected or self._busy or not self._jobs.empty():
                continue

            try:
                pid = winapi.find_process(ROBLOX_IMAGE)
            except Exception:
                pid = None

            if not pid:
                self._auto_pid = None
                self._auto_tries = 0
                self._auto_seen_at = None
                self._auto_waited = False
                continue
            if pid != self._auto_pid:
                self._auto_pid = pid
                self._auto_tries = 0
                self._auto_seen_at = time.monotonic()
                self._auto_waited = False
            if self._auto_tries >= AUTO_ATTACH_TRIES:
                continue

            age = self._client_age(pid)
            if age < AUTO_ATTACH_MIN_AGE:
                if not self._auto_waited:
                    self._auto_waited = True
                    self.proto.log(
                        "[*] Auto attach: letting the client finish starting up first "
                        "(%ds) - taking hold of it any earlier is what closes the game"
                        % int(AUTO_ATTACH_MIN_AGE), "info",
                    )
                continue

            self._auto_tries += 1
            self.proto.log("[*] Auto attach: Roblox is running (PID %d) - attaching" % pid, "info")
            self._jobs.put((None, "attach", {}))

    def _client_age(self, pid: int) -> float:
        try:
            age = winapi.process_age(pid)
        except Exception:
            age = None
        if age is not None:
            return age
        if self._auto_seen_at is None:
            self._auto_seen_at = time.monotonic()
            return 0.0
        return time.monotonic() - self._auto_seen_at

    def _hold_auto_attach(self) -> None:
        self._auto_pid = self.session.pid
        self._auto_tries = AUTO_ATTACH_TRIES

    def _snapshot(self) -> Dict[str, Any]:
        snap = self.session.snapshot(len(self.flags))
        snap["stale"] = self._stale_names_count()
        snap["autoAttach"] = self.auto_attach
        return snap

    def _push_status(self) -> None:
        self.proto.event("status", **self._snapshot())

    def _stale_names(self) -> list:
        return [name for name in self.session.applied if name not in self.flags]

    def _stale_names_count(self) -> int:
        try:
            return len(self._stale_names())
        except Exception:
            return 0

    def _on_process_lost(self) -> None:
        self._auto_pid = None
        self._auto_tries = 0
        self.proto.event("lost")
        self._push_status()
        if self.auto_attach:
            self.proto.log("[*] Auto attach is on - waiting for the client to come back", "info")

    def _attach(self, args) -> Dict[str, Any]:
        ok = self.session.attach()
        if not ok and self.auto_attach and self._auto_tries >= AUTO_ATTACH_TRIES:
            self.proto.log(
                "[!] Auto attach gave up on PID %s - open the client again or press Attach"
                % (self._auto_pid or "?"), "warning",
            )
        return {"ok": ok}

    def _detach(self, args) -> Dict[str, Any]:
        keep = bool(args.get("keep"))
        had = len(self.session.applied)
        self._hold_auto_attach()
        if had and not keep:
            self.proto.log("[*] Taking %s flags back out before detaching..." % format(had, ","), "info")
        summary = self.session.detach("[+] Detached", restore=not keep)
        if had and not keep:
            self._report_wipe(summary, had)
        elif had and keep:
            self.proto.log(
                "[!] Detached with %s flags still live in the client - restart Roblox to clear them"
                % format(had, ","), "warning",
            )
        if self.auto_attach:
            self.proto.log(
                "[*] Auto attach will leave this client alone - it picks up the next one you open",
                "info",
            )
        return {"ok": True, "had": had, **summary}

    def _report_wipe(self, summary: Dict[str, Any], had: int) -> None:
        restored = summary.get("restored", 0)
        residue = summary.get("residue", 0)
        if restored:
            self.proto.log(
                "[+] Removed %s of %s flags - every byte read back as the client's own value"
                % (format(restored, ","), format(had or summary.get("touched", 0), ",")),
                "success",
            )
        if residue:
            self.proto.log(
                "[!] %s flag%s would not go back" % (format(residue, ","), "" if residue == 1 else "s"),
                "warning",
            )
            for name in summary.get("names", [])[:5]:
                self.proto.log("    %s" % name, "warning")
            self.proto.log("[*] Restart Roblox to be sure nothing is left behind", "warning")
        elif restored:
            self.proto.log("[+] Nothing left over - the client is back to stock", "success")

    def _load(self, args) -> Dict[str, Any]:
        path = args.get("path") or ""
        if not path:
            return {"ok": False, "error": "no path"}

        result = load_flag_file(path)
        if not result.flags:
            self.proto.log("[-] No FFlags in that file%s" % (" (%s)" % result.note if result.note else ""), "error")
            return {"ok": False, "count": 0, "note": result.note}

        self.flags = result.flags
        self.proto.log(
            "[+] Loaded %s flags (read as %s)" % (format(len(result.flags), ","), result.source),
            "success",
        )
        return {"ok": True, "count": len(result.flags), "source": result.source}

    def _inject(self, args) -> Dict[str, Any]:
        quiet = bool(args.get("quiet"))
        only = args.get("only")

        if not self.flags:
            if quiet:
                return {"ok": True, "total": 0, "success": 0, "failed": 0}
            self.proto.log("[!] Load a flag file first", "warning")
            return {"ok": False, "error": "no flags loaded"}
        if not self.session.connected:
            if quiet:
                return {"ok": False, "error": "not attached"}
            self.proto.log("[!] Attach to Roblox first", "warning")
            return {"ok": False, "error": "not attached"}
        if self.session.guard and self.session.build_checkable and self.session.build_matched is not True:
            if self.session.build_matched is False:
                self.proto.log(
                    "[-] Refusing to inject: Roblox is %s but the offsets are for %s"
                    % (self.session.client_build or "another build", self.session.table.version),
                    "error",
                )
                self.proto.log(
                    "[*] Reattach once the offset source has caught up, or turn Safe writes off "
                    "to inject anyway", "info",
                )
            else:
                self.proto.log(
                    "[-] Refusing to inject: the client's build could not be read, so it cannot be "
                    "checked against the offsets (%s)" % self.session.table.version, "error",
                )
                self.proto.log(
                    "[*] Run the app as Administrator and Attach again. Injecting a table built for "
                    "another build is what crashes the client", "info",
                )
            return {"ok": False, "error": "build mismatch"}

        wanted = dict(self.flags)
        if only is not None:
            wanted = {name: wanted[name] for name in only if name in wanted}
            if not wanted:
                return {"ok": True, "total": 0, "success": 0, "failed": 0}

        emit = None if quiet else self._throttled_progress()
        summary = self.session.apply_many(wanted, progress=emit, quiet=quiet)
        summary["ok"] = True
        return summary

    def _sync(self, args) -> Dict[str, Any]:
        if not self.session.connected:
            self.proto.log("[!] Attach to Roblox first", "warning")
            return {"ok": False, "error": "not attached"}

        stale = self._stale_names()
        removed = 0
        if stale:
            self.proto.log(
                "[*] Taking %s flag%s out of the client - they are not in the list any more"
                % (format(len(stale), ","), "" if len(stale) == 1 else "s"),
                "info",
            )
            removed = self.session.revert(stale).get("reverted", 0)

        if not self.flags:
            self.proto.log("[*] Saved - the list is empty, nothing left in the client", "info")
            self._push_status()
            return {"ok": True, "total": 0, "success": 0, "failed": 0, "removed": removed}

        summary = self._inject(dict(args, only=None))
        summary["removed"] = removed
        return summary

    def _revert(self, args) -> Dict[str, Any]:
        names = [str(name) for name in (args.get("names") or []) if name]
        if not names or not self.session.connected:
            return {"ok": True, "reverted": 0}

        summary = self.session.revert(names)
        if summary["reverted"]:
            self.proto.log(
                "[*] Live: took %s flag%s back out of the client"
                % (format(summary["reverted"], ","), "" if summary["reverted"] == 1 else "s"),
                "info",
            )
        return {"ok": True, **summary}

    def _throttled_progress(self):
        state = {"at": 0.0}

        def emit(done: int, total: int, ok: int, failed: int) -> None:
            now = time.monotonic()
            if done != total and (now - state["at"]) < PROGRESS_MIN_INTERVAL:
                return
            state["at"] = now
            self.proto.event("progress", current=done, total=total, success=ok, failed=failed)

        return emit

    def _restore(self, args) -> Dict[str, Any]:
        mode = args.get("mode", "spoof")
        if not self.session.connected:
            return {"ok": False, "error": "not attached"}

        had = len(self.session.applied)
        summary = self.session.wipe(use_defaults=(mode == "defaults"))
        self._report_wipe(summary, had)
        if mode != "defaults":
            self.flags = {}
            self.proto.log("[*] Flag list cleared as well", "info")
        return {"ok": True, "mode": mode, "success": summary["restored"], "had": had, **summary}

    def _status(self, args) -> Dict[str, Any]:
        return {"status": self._snapshot()}

    def _settings(self, args) -> Dict[str, Any]:
        if "fuzzy" in args:
            self.session.fuzzy = bool(args["fuzzy"])
            self.proto.log(
                "[*] Closest-name matching %s" % ("on - misses will be guessed" if self.session.fuzzy else "off"),
                "warning" if self.session.fuzzy else "info",
            )
        if "guard" in args and bool(args["guard"]) != self.session.guard:
            self.session.guard = bool(args["guard"])
            self.session.forget_resolutions()
            if self.session.guard:
                self.proto.log("[*] Safe writes on - a write that would overrun its flag is refused", "info")
            else:
                self.proto.log(
                    "[!] Safe writes OFF - every offset is trusted as-is, including ones that "
                    "point into the client's code. This is how the client crashes",
                    "warning",
                )
        if "limits" in args and bool(args["limits"]) != self.session.limits:
            self.session.limits = bool(args["limits"])
            if self.session.limits:
                self.proto.log("[*] Sane limits on - runaway cache and preload values get capped", "info")
            else:
                self.proto.log(
                    "[!] Sane limits OFF - a 2 GB cache or an unbounded preload goes in as written. "
                    "This is what fills your RAM until the machine stops",
                    "warning",
                )
        if "autoAttach" in args and bool(args["autoAttach"]) != self.auto_attach:
            self.auto_attach = bool(args["autoAttach"])
            if self.auto_attach:
                self._auto_pid = None
                self._auto_tries = 0
                self._auto_wake.set()
                self.proto.log(
                    "[*] Auto attach on - the client gets picked up as soon as it is running", "info",
                )
            else:
                self.proto.log("[*] Auto attach off", "info")

        self._push_status()
        return {
            "fuzzy": self.session.fuzzy,
            "guard": self.session.guard,
            "limits": self.session.limits,
            "autoAttach": self.auto_attach,
        }

    def _sample(self, args) -> Dict[str, Any]:
        limit = int(args.get("limit") or SAMPLE_LIMIT)
        offset = max(0, int(args.get("offset") or 0))
        query = str(args.get("query") or "").lower()

        names = sorted(self.flags)
        if query:
            names = [name for name in names if query in name.lower()]
        matched = len(names)
        window = names[offset: offset + limit]

        rows = []
        for name in window:
            codec, _ = flagtypes.resolve(name)
            rows.append({
                "name": name,
                "value": self.flags[name],
                "kind": codec.kind,
                "known": self._is_known(name),
            })
        return {"rows": rows, "total": len(self.flags), "matched": matched, "offset": offset}

    def _parse(self, args) -> Dict[str, Any]:
        path = str(args.get("path") or "")
        if not path:
            return {"ok": False, "error": "no path"}

        result = load_flag_file(path)
        if not result.flags:
            return {"ok": False, "error": result.note or "no FFlags found"}
        return {
            "flags": result.flags,
            "count": len(result.flags),
            "source": result.source,
            "duplicates": sum(1 for name in result.flags if name in self.flags),
            "unknown": sum(1 for name in result.flags if self._is_known(name) is False),
        }

    def _parse_text(self, args) -> Dict[str, Any]:
        text = str(args.get("text") or "")
        if not text.strip():
            return {"flags": {}, "count": 0, "duplicates": 0, "unknown": 0}

        found, _ = flagfile.collect(text)
        duplicates = sum(1 for name in found if name in self.flags)
        unknown = sum(1 for name in found if self._is_known(name) is False)
        return {
            "flags": found,
            "count": len(found),
            "duplicates": duplicates,
            "unknown": unknown,
        }

    def _suggest(self, args) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip().lower()
        limit = max(1, min(30, int(args.get("limit") or 10)))
        table = self.session.table
        if not query or not table:
            return {"names": [], "total": 0, "exact": False, "offsets": len(table) if table else 0}

        hits = [name for name in table.values if query in name.lower()]
        hits.sort(key=lambda name: (not name.lower().startswith(query), len(name), name))
        return {
            "names": hits[:limit],
            "total": len(hits),
            "exact": any(name.lower() == query for name in hits),
            "offsets": len(table),
        }

    def _is_known(self, name: str):
        if not self.session.table:
            return None
        codec, bare = flagtypes.resolve(name)
        return bool(self.session.table.lookup(bare, name))

    def _flag_set(self, args) -> Dict[str, Any]:
        name = str(args.get("name") or "").strip()
        if not name:
            return {"ok": False, "error": "empty flag name"}
        previous = str(args.get("previous") or "").strip()
        dropped = []
        if previous and previous != name:
            self.flags.pop(previous, None)
            dropped.append(previous)
        self.flags[name] = args.get("value")
        self._push_status()
        return {"name": name, "total": len(self.flags)}

    def _flag_remove(self, args) -> Dict[str, Any]:
        for name in args.get("names") or [args.get("name")]:
            if name:
                self.flags.pop(str(name), None)
        self._push_status()
        return {"total": len(self.flags)}

    def _flags_replace(self, args) -> Dict[str, Any]:
        incoming = args.get("flags")
        if not isinstance(incoming, dict):
            return {"ok": False, "error": "flags must be an object"}

        skipped = 0
        if args.get("merge"):
            if args.get("keep"):
                fresh = {name: value for name, value in incoming.items() if name not in self.flags}
                skipped = len(incoming) - len(fresh)
                incoming = fresh
            self.flags.update(incoming)
        else:
            self.flags = dict(incoming)

        self._push_status()
        return {"total": len(self.flags), "added": len(incoming), "skipped": skipped}

    def _flags_text(self, args) -> Dict[str, Any]:
        text = str(args.get("text") or "")
        if not text.strip():
            return {"ok": False, "error": "nothing to read"}

        found, _ = flagfile.collect(text)
        if not found:
            self.proto.log("[-] No FFlags in that text", "warning")
            return {"ok": False, "added": 0}

        skipped = 0
        if args.get("merge", True):
            if args.get("keep"):
                fresh = {name: value for name, value in found.items() if name not in self.flags}
                skipped = len(found) - len(fresh)
                found = fresh
            self.flags.update(found)
        else:
            self.flags = dict(found)

        self.proto.log(
            "[+] Added %s flags%s"
            % (format(len(found), ","), " (%s duplicates kept as they were)" % format(skipped, ",") if skipped else ""),
            "success",
        )
        self._push_status()
        return {"added": len(found), "total": len(self.flags), "skipped": skipped}

    def _flags_all(self, args) -> Dict[str, Any]:
        return {"flags": dict(self.flags), "total": len(self.flags)}

    def _clear(self, args) -> Dict[str, Any]:
        self.flags = {}
        self.proto.log("[*] Flag list cleared", "info")
        self._push_status()
        return {}

    def _monitor(self, args) -> Dict[str, Any]:
        want_on = bool(args.get("on", True))
        was_armed = self.session.monitor_armed
        running = self.session.set_monitor(want_on, args.get("interval"))

        if want_on and not was_armed:
            if running:
                self.proto.log(
                    "[*] Live Monitor is on - press Save config to write the list into the client",
                    "info",
                )
            else:
                self.proto.log(
                    "[*] Live Monitor is on and waiting - it starts by itself the moment you attach",
                    "info",
                )
        elif not want_on and was_armed:
            self.proto.log("[*] Monitor off", "info")

        self._push_status()
        return {"monitoring": self.session.monitoring, "armed": self.session.monitor_armed}

    def _probe(self, args) -> Dict[str, Any]:
        try:
            pid = winapi.find_process(ROBLOX_IMAGE)
        except Exception:
            pid = None
        return {"pid": pid or 0, "running": bool(pid)}

    def _macro_snapshot(self) -> Dict[str, Any]:
        return {
            "recording": self.recorder.recording,
            "playing": self.player.playing,
            "steps": len(self.recorder.snapshot()),
            "loopsDone": self.player.loops_done,
        }

    def _push_macro(self) -> None:
        self.proto.event("macro", **self._macro_snapshot())

    def _on_macro_finish(self, loops: int, stopped: bool) -> None:
        if stopped:
            self.proto.log("[*] Macro stopped after %s pass%s" % (format(loops, ","), "" if loops == 1 else "es"), "info")
        else:
            self.proto.log("[+] Macro finished - %s pass%s" % (format(loops, ","), "" if loops == 1 else "es"), "success")
        self._push_macro()

    def _macro_record(self, args) -> Dict[str, Any]:
        want_on = bool(args.get("on", True))
        if want_on:
            if self.player.playing:
                return {"ok": False, "error": "a macro is playing"}
            if not self.recorder.start(capture_moves=bool(args.get("moves", True))):
                return {"ok": False, "error": "already recording"}
            self.proto.log("[*] Recording - every key and click is being written down", "info")
            self._push_macro()
            return {"recording": True}

        recorded = self.recorder.stop()
        self.proto.log(
            "[+] Recorded %s step%s" % (format(len(recorded), ","), "" if len(recorded) == 1 else "s"),
            "success" if recorded else "warning",
        )
        self._push_macro()
        return {"recording": False, "steps": recorded, "count": len(recorded)}

    def _macro_play(self, args) -> Dict[str, Any]:
        if self.recorder.recording:
            return {"ok": False, "error": "still recording"}
        steps = args.get("steps")
        if not isinstance(steps, list) or not steps:
            return {"ok": False, "error": "nothing to play"}
        repeat = int(args.get("repeat") or 1)
        speed = float(args.get("speed") or 1.0)
        if not self.player.start(steps, repeat=repeat, speed=speed):
            return {"ok": False, "error": "already playing"}
        self.proto.log(
            "[*] Playing %s step%s %s"
            % (
                format(len(steps), ","),
                "" if len(steps) == 1 else "s",
                "on a loop" if repeat == 0 else "%sx" % format(repeat, ","),
            ),
            "info",
        )
        self._push_macro()
        return {"playing": True, "steps": len(steps)}

    def _macro_stop(self, args) -> Dict[str, Any]:
        stopped = False
        if self.recorder.recording:
            self.recorder.stop()
            stopped = True
        if self.player.playing:
            self.player.stop()
            stopped = True
        self._push_macro()
        return {"stopped": stopped, **self._macro_snapshot()}

    def _macro_state(self, args) -> Dict[str, Any]:
        return self._macro_snapshot()

    def _cancel(self, args) -> Dict[str, Any]:
        self.session.abort.set()
        self.proto.log("[!] Stopping...", "warning")
        return {}

    def _quit(self, args) -> Dict[str, Any]:
        self.running = False
        return {}
