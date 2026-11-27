"""Verify the complete architecture matrix and prepare delivery metadata."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = Path(sys.argv[1]).resolve()
download = f"https://github.com/sametcn99/repotruck/releases/download/v{version}"

def archive(os_name, arch):
    extension = "zip" if os_name == "windows" else "tar.gz"
    return f"repotruck-{version}-{os_name}-{arch}.{extension}"

digest = {}
for os_name in ("linux", "macos", "windows"):
    for arch in ("x64", "arm64"):
        name = archive(os_name, arch)
        with (output / name).open("rb") as file:
            digest[name] = hashlib.file_digest(file, "sha256").hexdigest()

(output / "SHA256SUMS").write_text("".join(f"{value}  {name}\n" for name, value in sorted(digest.items())),
                                   encoding="ascii", newline="\n")
for installer in ("install.sh", "install.ps1"):
    shutil.copyfile(root / installer, output / installer)

intel = archive("macos", "x64")
arm = archive("macos", "arm64")
mac_version = version.replace("-", ".")
formula = f'''class Repotruck < Formula
  desc "Organize and sync GitHub repositories and Gists"
  homepage "https://sametcn99.github.io/repotruck/"
  version "{mac_version}"
  license "MIT"

  depends_on :macos
  depends_on "git"

  on_intel do
    url "{download}/{intel}"
    sha256 "{digest[intel]}"
  end

  on_arm do
    url "{download}/{arm}"
    sha256 "{digest[arm]}"
  end

  def install
    libexec.install "repotruck", "assets", "LICENSE", "licenses"
    (libexec/"install-channel").write "homebrew\\n"
    bin.install_symlink libexec/"repotruck"
  end

  test do
    assert_equal version.to_s, shell_output("#{{bin}}/repotruck --version").strip
  end
end
'''
manifests = output / "manifests"
(manifests / "Formula").mkdir(parents=True, exist_ok=True)
(manifests / "bucket").mkdir(parents=True, exist_ok=True)
(manifests / "Formula/repotruck.rb").write_text(formula, encoding="utf-8", newline="\n")
manifest_arch = {}
for key, arch in (("64bit", "x64"), ("arm64", "arm64")):
    name = archive("windows", arch)
    manifest_arch[key] = {
        "url": f"{download}/{name}",
        "hash": digest[name],
        "extract_dir": f"repotruck-{version}-windows-{arch}",
    }
manifest = {
    "version": version,
    "description": "Organize and sync GitHub repositories and Gists",
    "homepage": "https://sametcn99.github.io/repotruck/",
    "license": "MIT",
    "architecture": manifest_arch,
    "bin": "repotruck.exe",
    "post_install": "Set-Content -LiteralPath \"$dir\\install-channel\" -Value scoop -Encoding ascii",
}
(manifests / "bucket/repotruck.json").write_text(json.dumps(manifest, indent=2) + "\n",
                                              encoding="utf-8", newline="\n")
