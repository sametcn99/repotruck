class Repotruck < Formula
  desc "Organize and sync GitHub repositories and Gists"
  homepage "https://sametcn99.github.io/repotruck/"
  version "1.0.7"
  license "MIT"

  depends_on :macos
  depends_on "git"

  on_intel do
    url "https://github.com/sametcn99/repotruck/releases/download/v1.0.7/repotruck-1.0.7-macos-x64.tar.gz"
    sha256 "c8505dcd819212be6e235dcd0e6195060212288ce9fdb8472c969976274fa819"
  end

  on_arm do
    url "https://github.com/sametcn99/repotruck/releases/download/v1.0.7/repotruck-1.0.7-macos-arm64.tar.gz"
    sha256 "2404e4fed404d5b1d547bdb92716ebaeeb3c0956e6dec54f6f4f3ae80a5736d5"
  end

  def install
    libexec.install "repotruck", "assets", "LICENSE", "licenses"
    (libexec/"install-channel").write "homebrew\n"
    bin.install_symlink libexec/"repotruck"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/repotruck --version").strip
  end
end
