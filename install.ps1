param(
    [string] $Version,
    [switch] $NoPath
)
$ErrorActionPreference = 'Stop'

function Install-Repotruck {
    $ProgressPreference = 'SilentlyContinue'
    $releaseUrl = $env:REPOTRUCK_INSTALL_RELEASES_URL
    if (-not $releaseUrl) { $releaseUrl = 'https://github.com/sametcn99/repotruck/releases' }
    $releaseUrl = $releaseUrl.TrimEnd('/')
    $tag = $Version
    if (-not $tag) {
        $result = Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/latest"
        $response = $result.BaseResponse
        $uri = if ($response.ResponseUri) { $response.ResponseUri } else { $response.RequestMessage.RequestUri }
        if (-not $uri.AbsoluteUri.StartsWith("$releaseUrl/tag/", [StringComparison]::Ordinal)) {
            throw 'Unexpected release link'
        }
        $tag = $uri.Segments[-1]
        if ($tag.Contains('-')) { throw 'Expected a stable release' }
    }
    if (-not $tag.StartsWith('v')) { $tag = "v$tag" }
    if ($tag -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$') {
        throw 'Expected a version such as 1.0.7'
    }

    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Architecture
    $arch = switch ($cpu) {
        9 { 'x64' }
        12 { 'arm64' }
        default { throw "Unsupported Windows architecture: $cpu" }
    }
    $root = $env:REPOTRUCK_INSTALL_ROOT
    if (-not $root) { $root = Join-Path $env:LOCALAPPDATA 'Programs\Repotruck' }
    if (-not [IO.Path]::IsPathRooted($root)) { throw 'Installation directory must be absolute' }
    $root = [IO.Path]::GetFullPath($root)
    [void][IO.Directory]::CreateDirectory($root)
    $lockPath = Join-Path $root '.install-lock'
    $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
    $stage = Join-Path $root ('.stage-' + [guid]::NewGuid().ToString('N'))
    $current = Join-Path $root 'current'
    $backup = Join-Path $root ('.backup-' + [guid]::NewGuid().ToString('N'))
    try {
        if (Test-Path -LiteralPath $current) {
            $channel = Join-Path $current 'install-channel'
            if (-not (Test-Path -LiteralPath $channel) -or
                [IO.File]::ReadAllText($channel).Trim() -cne 'installer') {
                throw "Existing installation at $current belongs to another channel"
            }
        }
        [void][IO.Directory]::CreateDirectory($stage)
        $number = $tag.Substring(1)
        $name = "repotruck-$number-windows-$arch"
        $archive = "$name.zip"
        $base = "$releaseUrl/download/$tag"
        $checksums = Join-Path $stage 'SHA256SUMS'
        $zip = Join-Path $stage $archive
        Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $checksums
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile $zip
        $pattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($archive) + '$'
        $entries = @(Select-String -LiteralPath $checksums -Pattern $pattern)
        if ($entries.Count -ne 1) { throw "No unique checksum for $archive" }
        $expected = $entries[0].Matches[0].Groups[1].Value
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine $expected) {
            throw "Checksum mismatch for $archive"
        }
        Expand-Archive -LiteralPath $zip -DestinationPath $stage
        $candidate = Join-Path $stage $name
        $exe = Join-Path $candidate 'repotruck.exe'
        $detected = & $exe --version
        if ($LASTEXITCODE -ne 0 -or "$detected".Trim() -cne $number) { throw 'Archive version mismatch' }
        [IO.File]::WriteAllText((Join-Path $candidate 'install-channel'), 'installer')
        if (Test-Path -LiteralPath $current) { [IO.Directory]::Move($current, $backup) }
        try {
            [IO.Directory]::Move($candidate, $current)
        } catch {
            if (Test-Path -LiteralPath $backup) { [IO.Directory]::Move($backup, $current) }
            throw
        }

        if (-not $NoPath) {
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if (@($userPath -split ';' | ForEach-Object { $_.TrimEnd('\') }) -notcontains $current) {
                $newPath = if ($userPath) { $userPath.TrimEnd(';') + ';' + $current } else { $current }
                [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            }
            if (@($env:Path -split ';' | ForEach-Object { $_.TrimEnd('\') }) -notcontains $current) {
                $env:Path += ";$current"
            }
        }
        if (Test-Path -LiteralPath $backup) {
            Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Output "Installed Repotruck $number at $(Join-Path $current 'repotruck.exe')"
    } finally {
        $lock.Dispose()
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    }
}

Install-Repotruck
