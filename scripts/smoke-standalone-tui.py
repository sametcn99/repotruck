"""Run the installed binary in a terminal, including Windows ConPTY."""
import errno
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def exercise(read, send, poll):
    transcript = bytearray()
    deadline = time.monotonic() + 20
    sent_quit = False
    while time.monotonic() < deadline:
        transcript.extend(read())
        if not sent_quit and b"Repositories" in transcript:
            send(b"q")
            sent_quit = True
        status = poll()
        if status is not None:
            if status == 0 and sent_quit:
                print("Standalone TUI rendered Cockpit and exited with q")
                return
            break
        time.sleep(0.025)
    raise RuntimeError(f"Interactive smoke failed (exit={poll()}): {transcript[-3500:]!r}")


def posix(executable):
    import fcntl
    import pty
    import select
    import struct
    import termios

    master, terminal = pty.openpty()
    fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack("HHHH", 35, 115, 0, 0))
    process = subprocess.Popen(
        [str(executable)], stdin=terminal, stdout=terminal, stderr=terminal
    )
    os.close(terminal)

    def read():
        if not select.select([master], [], [], 0)[0]:
            return b""
        try:
            return os.read(master, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            return b""

    try:
        exercise(read, lambda data: os.write(master, data), process.poll)
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        os.close(master)


def windows(executable):
    import ctypes as c
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    handle_ptr = c.POINTER(w.HANDLE)
    size_ptr = c.POINTER(c.c_size_t)

    def api(name, result, *args):
        fn = getattr(kernel, name)
        fn.restype, fn.argtypes = result, args
        return fn

    def check(succeeded):
        if not succeeded:
            raise c.WinError(c.get_last_error())

    class Coord(c.Structure):
        _fields_ = [("x", c.c_short), ("y", c.c_short)]

    class Startup(c.Structure):
        _fields_ = [
            ("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR),
            ("title", w.LPWSTR),
            *[(field, w.DWORD) for field in
              ("x", "y", "width", "height", "cols", "rows", "fill", "flags")],
            ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_bytes", c.c_void_p),
            ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE),
            ("attribute_list", c.c_void_p),
        ]

    class Process(c.Structure):
        _fields_ = [("handle", w.HANDLE), ("thread", w.HANDLE),
                    ("pid", w.DWORD), ("tid", w.DWORD)]

    pipe = api("CreatePipe", w.BOOL, handle_ptr, handle_ptr, c.c_void_p, w.DWORD)
    close = api("CloseHandle", w.BOOL, w.HANDLE)
    create_pty = api("CreatePseudoConsole", c.c_long, Coord, w.HANDLE, w.HANDLE, w.DWORD, handle_ptr)
    close_pty = api("ClosePseudoConsole", None, w.HANDLE)
    initialize = api("InitializeProcThreadAttributeList", w.BOOL, c.c_void_p, w.DWORD, w.DWORD, size_ptr)
    update = api("UpdateProcThreadAttribute", w.BOOL, c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, size_ptr)
    delete = api("DeleteProcThreadAttributeList", None, c.c_void_p)
    launch = api("CreateProcessW", w.BOOL, w.LPCWSTR, w.LPWSTR, c.c_void_p,
                 c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR,
                 c.POINTER(Startup), c.POINTER(Process))
    peek = api("PeekNamedPipe", w.BOOL, w.HANDLE, c.c_void_p, w.DWORD,
               c.c_void_p, c.POINTER(w.DWORD), c.c_void_p)
    read_file = api("ReadFile", w.BOOL, w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p)
    write_file = api("WriteFile", w.BOOL, w.HANDLE, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), c.c_void_p)
    wait = api("WaitForSingleObject", w.DWORD, w.HANDLE, w.DWORD)
    exit_code = api("GetExitCodeProcess", w.BOOL, w.HANDLE, c.POINTER(w.DWORD))
    terminate = api("TerminateProcess", w.BOOL, w.HANDLE, w.UINT)

    child_input, input_pipe, output_pipe, child_output, console = [w.HANDLE() for _ in range(5)]
    process = Process()
    initialized = False
    startup = Startup()
    check(pipe(c.byref(child_input), c.byref(input_pipe), None, 0))
    try:
        check(pipe(c.byref(output_pipe), c.byref(child_output), None, 0))
        status = create_pty(Coord(115, 35), child_input, child_output, 0, c.byref(console))
        if status != 0:
            raise OSError(f"CreatePseudoConsole failed: {status}")
        close(child_input)
        close(child_output)
        child_input = child_output = None
        size = c.c_size_t()
        initialize(None, 1, 0, c.byref(size))
        attributes = c.create_string_buffer(size.value)
        check(initialize(attributes, 1, 0, c.byref(size)))
        initialized = True
        check(update(attributes, 0, 0x20016, console, c.sizeof(console), None, None))
        startup.cb = c.sizeof(Startup)
        startup.attribute_list = c.addressof(attributes)
        command = c.create_unicode_buffer(subprocess.list2cmdline([str(executable)]))
        check(launch(str(executable), command, None, None, False, 0x80000,
                     None, None, c.byref(startup), c.byref(process)))

        def read():
            available = w.DWORD()
            if not peek(output_pipe, None, 0, None, c.byref(available), None) or not available.value:
                return b""
            buffer = c.create_string_buffer(min(available.value, 65536))
            count = w.DWORD()
            check(read_file(output_pipe, buffer, len(buffer), c.byref(count), None))
            return buffer.raw[:count.value]

        def send(data):
            count = w.DWORD()
            check(write_file(input_pipe, data, len(data), c.byref(count), None))

        def poll():
            if wait(process.handle, 0) == 0x102:
                return None
            value = w.DWORD()
            check(exit_code(process.handle, c.byref(value)))
            return value.value

        exercise(read, send, poll)
    finally:
        if process.handle:
            if wait(process.handle, 0) == 0x102:
                terminate(process.handle, 1)
            wait(process.handle, 3000)
            close(process.thread)
            close(process.handle)
        if initialized:
            delete(startup.attribute_list)
        for handle in (child_input, child_output, input_pipe, output_pipe):
            if handle:
                close(handle)
        if console:
            close_pty(console)


def main():
    executable = Path(sys.argv[1]).absolute()
    with tempfile.TemporaryDirectory(prefix="rt-tui-") as directory:
        root = Path(directory)
        config = root / "config"
        config.mkdir()
        (config / "config.json").write_text(json.dumps({"defaultRoot": str(root)}), encoding="utf-8")
        os.environ.update(
            REPOTRUCK_CONFIG_DIR=str(config), REPOTRUCK_OFFLINE="1",
            REPOTRUCK_NO_AGENTS_MD_MIGRATE="1", REPOTRUCK_NO_UPDATE_CHECK="1",
            TERM="xterm-256color",
        )
        previous = Path.cwd()
        try:
            os.chdir(root)
            if sys.platform == "win32":
                windows(executable)
            else:
                posix(executable)
        finally:
            os.chdir(previous)


if __name__ == "__main__":
    main()
