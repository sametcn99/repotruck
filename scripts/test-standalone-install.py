"""Exercise the real installer and installed executable against a release fixture."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from threading import Thread

repository = Path(__file__).resolve().parent.parent
public = sys.argv[1] == "--public"
archive = None if public else Path(sys.argv[1]).resolve()
version = sys.argv[2]
changed_checksum = False


class Release(BaseHTTPRequestHandler):
    def do_GET(self):
        tag = f"v{version}"
        if self.path == "/releases/latest":
            self.send_response(302)
            self.send_header("Location", f"/releases/tag/{tag}")
            self.end_headers()
            return
        if self.path == f"/releases/tag/{tag}":
            self.send_response(200)
            self.end_headers()
            return
        prefix = f"/releases/download/{tag}/"
        file = self.path.removeprefix(prefix)
        files = {
            archive.name: archive,
            "SHA256SUMS": archive.parent / "SHA256SUMS",
            "install.sh": repository / "install.sh",
            "install.ps1": repository / "install.ps1",
        }
        if not self.path.startswith(prefix) or file not in files:
            self.send_error(404)
            return
        source = files[file]
        invalid_checksum = file == "SHA256SUMS" and changed_checksum
        checksum = f"{'0' * 64}  {archive.name}\n".encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(checksum) if invalid_checksum else source.stat().st_size))
        self.end_headers()
        if invalid_checksum:
            self.wfile.write(checksum)
        else:
            with source.open("rb") as content:
                shutil.copyfileobj(content, self.wfile)

    def log_message(self, *args):
        pass


def checked(args, env=None):
    result = subprocess.run(
        [str(arg) for arg in args], env=env, text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=180,
    )
    if result.returncode:
        print(result.stdout, file=sys.stderr)
        result.check_returncode()
    return result.stdout.strip()


def user_path():
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            return winreg.QueryValueEx(key, "Path")[0]
    except FileNotFoundError:
        return ""


def verify_path(binary):
    expected = os.path.normcase(str(binary.parent.resolve()))
    entries = user_path().split(";")
    matches = [entry for entry in entries if os.path.normcase(entry.rstrip("\\")) == expected]
    assert len(matches) == 1, f"Expected one user PATH entry for {expected}. Found {entries!r}"


server = None
if not public:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Release)
    Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix="rt native install ") as tmp:
        base = Path(tmp).resolve()
        install_root = base / "app"
        install_bin = base / ".local" / "bin"
        profile = base / ".profile"
        env = dict(os.environ, REPOTRUCK_INSTALL_ROOT=str(install_root))
        if public:
            releases = "https://github.com/sametcn99/repotruck/releases"
            env.pop("REPOTRUCK_INSTALL_RELEASES_URL", None)
            script_url = f"{releases}/latest/download/install"
        else:
            releases = f"http://127.0.0.1:{server.server_port}/releases"
            env["REPOTRUCK_INSTALL_RELEASES_URL"] = releases
            script_url = f"{releases}/download/v{version}/install"
        install_sh = f"curl -fsSL {script_url}.sh | sh"
        if os.name == "nt":
            binary = install_root / "current" / "repotruck.exe"
            install = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                       f"$ErrorActionPreference = 'Stop'; irm '{script_url}.ps1' | iex; "
                       f"if ((repotruck --version) -cne '{version}') {{ throw 'Session PATH version mismatch' }}"]
            initial_user_path = user_path()
        else:
            env.update(HOME=str(base), REPOTRUCK_INSTALL_BIN=str(install_bin),
                       REPOTRUCK_INSTALL_PROFILE=str(profile))
            binary = install_bin / "repotruck"
            install = ["/bin/sh", "-c", install_sh]

        def verify():
            assert checked([binary, "--version"]) == version

        try:
            print(checked(install, env))
            verify()
            if os.name == "nt":
                verify_path(binary)
                if not public:
                    print("Reinstalling through PowerShell")
                    print(checked(install, env))
                git = Path(shutil.which("git")).resolve()
                git_bash = next(parent / "bin" / "bash.exe" for parent in git.parents
                                if (parent / "bin" / "bash.exe").is_file())
                print("Reinstalling through Git Bash")
                print(checked([git_bash, "-lc", install_sh + " -s -- --no-path"], env))
                verify()
                verify_path(binary)
            else:
                if not public:
                    first = binary.resolve()
                    print(checked(["/bin/sh", "-c", install_sh + f" -s -- --version {version}"], env))
                    assert binary.resolve() != first and first.is_file()
                assert profile.read_text().count("# Repotruck user PATH") == 1
                assert checked(["/bin/sh", "-c", '. "$REPOTRUCK_INSTALL_PROFILE"; command -v repotruck'],
                               env) == str(binary)
                verify()
            if not public:
                print("Verifying that a corrupt checksum preserves the installation")
                changed_checksum = True
                try:
                    subprocess.check_output(install, env=env, text=True, stderr=subprocess.STDOUT, timeout=180)
                except subprocess.CalledProcessError as error:
                    assert "Checksum mismatch" in error.output, error.output
                else:
                    raise AssertionError("Corrupt checksum accepted")
                verify()
            print("Exercising the installed CLI, offline search, and MCP server")
            print(checked(["node", repository / "scripts" / "smoke-installed.mjs",
                           "--binary", binary, version]))
            print("Opening the installed TUI in a pseudoterminal")
            print(checked([sys.executable, repository / "scripts" / "smoke-standalone-tui.py", binary]))
        finally:
            if os.name == "nt":
                checked(["powershell.exe", "-NoProfile", "-Command",
                         "[Environment]::SetEnvironmentVariable('Path',$env:REPOTRUCK_ORIGINAL_PATH,'User')"],
                        dict(env, REPOTRUCK_ORIGINAL_PATH=initial_user_path))
finally:
    if server:
        server.shutdown()
        server.server_close()
