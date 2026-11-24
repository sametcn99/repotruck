"""Real controlling-terminal startup, About, child app and resume smoke.

Called by hardening-processes.test.ts on POSIX; no GitHub or user config access.
"""
import fcntl
import json
import os
import pty
import re
import unicodedata
import select
import shlex
import signal
import struct
import sys
import termios
import time

runtime, entry, marker, expected_cwd, moved_cwd, config_file = sys.argv[1:]
pid, master = pty.fork()
if pid == 0:
    os.execvpe(runtime, [runtime, *shlex.split(os.environ.get("REPOTRUCK_TUI_TEST_FLAGS", "")), entry], os.environ)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 120, 0, 0))
output = bytearray()


def screen_text(start=0):
    # Decode cursor-addressed partial repaints as a terminal, rather than
    # assuming an entire label arrives in one contiguous stdout chunk.
    rows, cols = 36, 120
    grid = [[" "] * cols for _ in range(rows)]
    row = col = 0
    tokens = re.finditer(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z]|.", output[start:].decode("utf-8", "replace"), re.S)
    for match in tokens:
        token = match.group()
        if token.startswith("\x1b["):
            final, raw = token[-1], token[2:-1]
            if raw.startswith("?"):
                if raw == "?1049" and final == "h":
                    grid = [[" "] * cols for _ in range(rows)]
                    row = col = 0
                continue
            try:
                values = [int(value or "0") for value in raw.split(";")]
            except ValueError:
                continue
            amount = values[0] or 1
            if final in "Hf":
                row = min(rows - 1, max(0, (values[0] or 1) - 1))
                col = min(cols - 1, max(0, (values[1] if len(values) > 1 else 1) - 1))
            elif final == "G": col = min(cols - 1, amount - 1)
            elif final == "d": row = min(rows - 1, amount - 1)
            elif final == "A": row = max(0, row - amount)
            elif final == "B": row = min(rows - 1, row + amount)
            elif final == "C": col = min(cols - 1, col + amount)
            elif final == "D": col = max(0, col - amount)
            elif final == "J" and values[0] in (2, 3): grid = [[" "] * cols for _ in range(rows)]
            elif final == "K":
                start, end = (0, cols) if values[0] == 2 else (0, col + 1) if values[0] == 1 else (col, cols)
                grid[row][start:end] = [" "] * (end - start)
            continue
        if token.startswith("\x1b"): continue
        if token == "\r": col = 0
        elif token == "\n":
            row += 1
            if row >= rows: grid.pop(0); grid.append([" "] * cols); row = rows - 1
        elif token == "\b": col = max(0, col - 1)
        elif ord(token) >= 32 and not unicodedata.combining(token):
            if col >= cols: row = min(rows - 1, row + 1); col = 0
            grid[row][col] = token
            col += 2 if unicodedata.east_asian_width(token) in ("W", "F") else 1
    return "\n".join("".join(line) for line in grid)


def pump_until(predicate, timeout=12):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("PTY condition timed out; current terminal:\n" + screen_text())
        if select.select([master], [], [], 0.05)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data:
                raise AssertionError("PTY exited before completing the flow: " + output[-6000:].decode("utf-8", "replace"))
            output.extend(data)


try:
    pump_until(lambda: "1 repositories" in screen_text())
    os.write(master, b"vo")
    pump_until(lambda: "github.com/sametcn99/repotruck" in screen_text())
    os.write(master, b"\x1b")
    # Escape is a real ambiguous terminal sequence. Wait for its decoded frame.
    before = len(output)
    pump_until(lambda: "1 repositories" in screen_text())
    os.write(master, b" ")
    pump_until(lambda: "1 selected" in screen_text())
    # Create a real in-memory undo action in the TUI before suspending it.
    # The action must remain available across both foreground app returns.
    os.write(master, b"m")
    pump_until(lambda: "Move repository" in screen_text())
    os.write(master, b"\x7f" * len("acme/source/api") + b"acme/moved/api\r")
    pump_until(lambda: "1 repositories" in screen_text() and "1 selected" in screen_text())
    assert not os.path.exists(expected_cwd), f"move did not leave original path: {expected_cwd}"
    assert os.path.isdir(moved_cwd), f"move did not create destination: {moved_cwd}"
    for launch in range(2):
        if os.path.exists(marker):
            os.remove(marker)
        os.write(master, b"o")
        before = len(output)
        pump_until(lambda: "Open in app" in screen_text() and "claude" in screen_text())
        os.write(master, b"\r")
        pump_until(lambda: os.path.exists(marker))
        with open(marker, encoding="utf-8") as handle:
            launched = json.load(handle)
        assert launched["cwd"] == moved_cwd, launched
        assert launched["args"] == [moved_cwd, "spaced argument", "ş🙂", "--literal"], launched
        before = len(output)
        pump_until(lambda: "1 repositories" in screen_text(before) and "1 selected" in screen_text(before) and "exit 17" in screen_text(before))
    pump_until(lambda: "2 ok/2 err" in screen_text(before))
    os.write(master, b"z")
    pump_until(lambda: "[DONE] [undo]" in screen_text() and "acme/source/api" in screen_text())
    assert os.path.isdir(expected_cwd), f"undo did not restore original path: {expected_cwd}"
    assert not os.path.exists(moved_cwd), f"undo left moved path behind: {moved_cwd}"
    with open(config_file, encoding="utf-8") as handle:
        persisted = json.load(handle)
    repo = next((item for item in persisted["workspaces"][0]["repos"] if item["owner"] == "acme" and item["name"] == "api"), None)
    assert repo is not None and repo["relativePath"] == "acme/source/api", persisted
    assert persisted["workspaces"][0].get("aliases", {}).get("api") == "acme/source/api", persisted
    os.write(master, b"q")
    deadline = time.monotonic() + 5
    status = None
    while time.monotonic() < deadline:
        child, value = os.waitpid(pid, os.WNOHANG)
        if child:
            status = value
            break
        if select.select([master], [], [], 0.05)[0]:
            try:
                output.extend(os.read(master, 65536))
            except OSError:
                pass
    assert status is not None, "TUI did not release terminal and exit"
    assert os.waitstatus_to_exitcode(status) == 0, status
    print(json.dumps({"pty": "passed", "appExit": 17, "resumeCycles": 2, "cwd": launched["cwd"], "argv": launched["args"], "undo": {"restored": expected_cwd, "removedMovedPath": moved_cwd, "alias": "api -> acme/source/api"}, "bytes": len(output)}, ensure_ascii=False))
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.close(master)
