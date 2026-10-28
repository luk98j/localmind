@echo off
setlocal
set "LOCALMIND_LAUNCH_ROOT=%~dp0"
cd /d "%~dp0"
if "%LOCALMIND_PORTABLE_NODE%"=="1" goto portable
where node >nul 2>&1
if errorlevel 1 goto portable
where npm.cmd >nul 2>&1
if errorlevel 1 goto portable
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto portable
set "node_cmd=node"
goto launch
:portable
set /p runtime_version=<"%~dp0scripts\node-version"
set "runtime_arch=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "runtime_arch=arm64"
if /I "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "runtime_arch=arm64"
set "LOCALMIND_RUNTIME_ARCH=%runtime_arch%"
set "runtime_dir=%~dp0.localmind\runtime\node-v%runtime_version%-win-%runtime_arch%"
if exist "%runtime_dir%\node.exe" if exist "%runtime_dir%\node_modules\npm\bin\npm-cli.js" goto cached
powershell.exe -NoProfile -Command ^
 "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
 "$root=$env:LOCALMIND_LAUNCH_ROOT; $version=(Get-Content -LiteralPath (Join-Path $root 'scripts\node-version') -Raw).Trim(); if($version -notmatch '^24\.\d+\.\d+$'){throw 'Invalid runtime version'};" ^
 "$folder='node-v'+$version+'-win-'+$env:LOCALMIND_RUNTIME_ARCH; $archive=$folder+'.zip'; $parent=Join-Path $root '.localmind\runtime'; $target=Join-Path $parent $folder;" ^
 "$pattern='^([a-f0-9]{64})\s+'+[regex]::Escape($archive)+'$'; $line=Get-Content -LiteralPath (Join-Path $root 'scripts\node-shasums.txt') | Where-Object {$_ -match $pattern}; if(@($line).Count -ne 1){throw 'Missing trusted runtime checksum'}; $expected=($line -split '\s+')[0];" ^
 "$stage=Join-Path $root ('.localmind\download-'+[Guid]::NewGuid().ToString()); New-Item -ItemType Directory -Path $stage -Force | Out-Null; try {" ^
 "Write-Host 'Preparing a local Node.js runtime. No system installation is needed.'; $zip=Join-Path $stage $archive; Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/v'+$version+'/'+$archive) -OutFile $zip;" ^
 "if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Node.js checksum mismatch. Download rejected.'}; Expand-Archive -LiteralPath $zip -DestinationPath $stage;" ^
 "New-Item -ItemType Directory -Path $parent -Force | Out-Null; if(-not (Test-Path -LiteralPath $target)){Move-Item -LiteralPath (Join-Path $stage $folder) -Destination $parent}" ^
 "} finally {Remove-Item -LiteralPath $stage -Recurse -Force}"
if errorlevel 1 goto failed
:cached
set "PATH=%runtime_dir%;%PATH%"
set "node_cmd=%runtime_dir%\node.exe"
"%node_cmd%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto failed
:launch
"%node_cmd%" "%~dp0scripts\launch.mjs" %*
set "launch_result=%ERRORLEVEL%"
if "%launch_result%"=="0" exit /b 0
if defined CI exit /b %launch_result%
pause
exit /b %launch_result%
:failed
echo LocalMind setup failed. Check your network connection and local permissions.
if defined CI exit /b 1
pause
exit /b 1
