"""Create the release archive from the native build directory."""
import hashlib
from pathlib import Path
import sys
import tarfile
import zipfile

directory = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
output.mkdir(parents=True, exist_ok=True)
if (directory / "repotruck.exe").exists():
    archive = output / (directory.name + ".zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for file in sorted(directory.rglob("*")):
            if file.is_file():
                package.write(file, file.relative_to(directory.parent).as_posix())
else:
    archive = output / (directory.name + ".tar.gz")
    with tarfile.open(archive, "w:gz", compresslevel=6) as package:
        package.add(directory, arcname=directory.name)
with archive.open("rb") as file:
    digest = hashlib.file_digest(file, "sha256").hexdigest()
(output / "SHA256SUMS").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
print(archive)
