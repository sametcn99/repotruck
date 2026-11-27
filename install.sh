#!/bin/sh
set -eu

release_url=${REPOTRUCK_INSTALL_RELEASES_URL:-https://github.com/sametcn99/repotruck/releases}
version=
add_path=1
stage=
lock=
link_dir=

fail() { printf 'Repotruck: %s\n' "$*" >&2; exit 1; }

cleanup() {
  [ -z "$stage" ] || rm -rf -- "$stage"
  [ -z "$link_dir" ] || rm -rf -- "$link_dir"
  [ -z "$lock" ] || rmdir -- "$lock"
}

check_version() {
  printf '%s\n' "$1" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$'
}

resolve_version() {
  if [ -z "$version" ]; then
    effective=$(curl -fsSL -o /dev/null -w '%{url_effective}' "$release_url/latest") ||
      fail 'Could not find the latest release'
    case "$effective" in "$release_url"/tag/*) version=${effective##*/} ;; *) fail 'Unexpected release link' ;; esac
    case "$version" in *-*) fail 'Expected a stable release' ;; esac
  fi
  case "$version" in v*) ;; *) version=v$version ;; esac
  check_version "$version" || fail 'Expected a version such as 1.0.7'
}

install_windows() {
  command -v powershell.exe >/dev/null || fail 'Windows PowerShell is required'
  command -v cygpath >/dev/null || fail 'Run the Windows installer from PowerShell'
  stage=$(mktemp -d)
  curl -fsSL "$release_url/download/$version/install.ps1" -o "$stage/install.ps1" ||
    fail 'Could not download the Windows installer'
  REPOTRUCK_INSTALL_PS1=$(cygpath -w "$stage/install.ps1") \
  REPOTRUCK_INSTALL_PIN="$version" REPOTRUCK_INSTALL_NO_PATH="$((1 - add_path))" \
  powershell.exe -NoProfile -NonInteractive -Command '
    $ErrorActionPreference = "Stop"
    $install = [ScriptBlock]::Create([IO.File]::ReadAllText($env:REPOTRUCK_INSTALL_PS1))
    & $install -Version $env:REPOTRUCK_INSTALL_PIN -NoPath:($env:REPOTRUCK_INSTALL_NO_PATH -eq "1")
  '
}

persist_path() {
  case ":$PATH:" in *:"$bin":*) return ;; esac
  [ "$add_path" = 1 ] || return 0
  shell=${SHELL:-sh}
  case "${shell##*/}" in
    zsh) profile=${ZDOTDIR:-$HOME}/.zshrc ;;
    bash) profile=$HOME/.bashrc; [ ! -f "$HOME/.bash_profile" ] || profile=$HOME/.bash_profile ;;
    *) profile=$HOME/.profile ;;
  esac
  profile=${REPOTRUCK_INSTALL_PROFILE:-$profile}
  # Only the default directory is added to a profile. Custom prefixes can set their own PATH.
  [ "$bin" = "$HOME/.local/bin" ] || return 0
  if ! grep -Fqx '# Repotruck user PATH' "$profile" 2>/dev/null; then
    printf '\n# Repotruck user PATH\ncase ":$PATH:" in *:"$HOME/.local/bin":*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac\n' >> "$profile" ||
      printf 'Could not update %s. Add %s to PATH.\n' "$profile" "$bin" >&2
  fi
}

install_unix() {
  arch=$(uname -m)
  if [ "$os" = macos ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  case "$arch" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) fail "Unsupported architecture: $arch" ;; esac
  if [ "$os" = linux ]; then
    getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'Linux releases require glibc'
  fi

  root=${REPOTRUCK_INSTALL_ROOT:-${XDG_DATA_HOME:-"$HOME/.local/share"}/repotruck}
  bin=${REPOTRUCK_INSTALL_BIN:-"$HOME/.local/bin"}
  case "$root:$bin" in /*:/*) ;; *) fail 'Installation directories must be absolute' ;; esac
  mkdir -p -- "$root/versions" "$bin"
  mkdir -- "$root/.install-lock" 2>/dev/null || fail 'Another installation is in progress'
  lock=$root/.install-lock
  if [ -e "$bin/repotruck" ] || [ -L "$bin/repotruck" ]; then
    existing=$(readlink "$bin/repotruck" 2>/dev/null || true)
    case "$existing" in "$root"/versions/*/repotruck) ;; *) fail "Existing executable at $bin/repotruck belongs to another installation" ;; esac
  fi

  stage=$(mktemp -d "$root/.stage.XXXXXX")
  name=repotruck-${version#v}-$os-$arch
  archive=$name.tar.gz
  base=$release_url/download/$version
  curl -fsSL "$base/SHA256SUMS" -o "$stage/SHA256SUMS" || fail 'Could not download checksums'
  curl -fsSL "$base/$archive" -o "$stage/$archive" || fail "Could not download $archive"
  expected=$(awk -v file="$archive" '$2 == file { hash=tolower($1); count++ } END { if(count!=1) exit 1; print hash }' "$stage/SHA256SUMS") ||
    fail "No unique checksum for $archive"
  printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail 'Invalid checksum'
  if command -v sha256sum >/dev/null; then
    actual=$(sha256sum "$stage/$archive")
  else
    actual=$(shasum -a 256 "$stage/$archive")
  fi
  [ "${actual%% *}" = "$expected" ] || fail "Checksum mismatch for $archive"
  tar -xzf "$stage/$archive" -C "$stage"
  [ "$("$stage/$name/repotruck" --version)" = "${version#v}" ] || fail 'Archive version mismatch'
  printf '%s\n' installer > "$stage/$name/install-channel"
  # Versioned directories keep a running executable and its asset files together.
  target=$(mktemp -d "$root/versions/$name.XXXXXX")
  rmdir -- "$target"
  mv -- "$stage/$name" "$target"
  link_dir=$(mktemp -d "$bin/.repotruck.XXXXXX")
  ln -s -- "$target/repotruck" "$link_dir/repotruck"
  mv -f -- "$link_dir/repotruck" "$bin/repotruck"
  persist_path
  printf 'Installed Repotruck %s at %s/repotruck\n' "${version#v}" "$bin"
  case ":$PATH:" in *:"$bin":*) ;; *) printf 'Use this full path now or open a new terminal after adding %s to PATH.\n' "$bin" ;; esac
}

main() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) [ "$#" -ge 2 ] || fail 'Missing --version value'; version=$2; shift ;;
      --no-path) add_path=0 ;;
      --help) printf 'Usage: install.sh [--version VERSION] [--no-path]\n'; return ;;
      *) fail "Unknown option: $1" ;;
    esac
    shift
  done
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM
  command -v curl >/dev/null || fail 'curl is required'
  resolve_version
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=macos ;;
    MINGW*|MSYS*) install_windows; return ;;
    *) fail "Unsupported operating system: $(uname -s)" ;;
  esac
  install_unix
}

main "$@"
