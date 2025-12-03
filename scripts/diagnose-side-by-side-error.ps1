# Side-by-side configuration 오류 진단 스크립트
# 
# 실행 방법:
#   PowerShell에서: .\scripts\diagnose-side-by-side-error.ps1

Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host "Side-by-side Configuration 오류 진단"
Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host ""

$exePath = "C:\Dev\harmful-expression-filter\dotnet\OnVoiceComBridge\bin\Release\net6.0\win-x64\publish\OnVoiceComBridge.exe"

if (-not (Test-Path $exePath)) {
    Write-Host "❌ 실행 파일을 찾을 수 없습니다: $exePath" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 실행 파일 발견: $exePath" -ForegroundColor Green
Write-Host ""

# 1. DLL 의존성 확인
Write-Host "[1] DLL 의존성 확인..." -ForegroundColor Yellow
Write-Host ""

$dumpbinPath = $null
$possibleDumpbinPaths = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Professional\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe",
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\Enterprise\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe"
)

foreach ($path in $possibleDumpbinPaths) {
    $found = Get-ChildItem -Path $path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        $dumpbinPath = $found.FullName
        break
    }
}

if ($dumpbinPath) {
    Write-Host "✅ dumpbin 발견: $dumpbinPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "의존 DLL 목록:" -ForegroundColor Cyan
    Write-Host "---"
    
    $vcvarsPath = Split-Path (Split-Path (Split-Path $dumpbinPath)) -Parent
    $vcvarsPath = Join-Path $vcvarsPath "Auxiliary\Build\vcvars64.bat"
    
    if (Test-Path $vcvarsPath) {
        $tempFile = [System.IO.Path]::GetTempFileName()
        $batContent = @"
@echo off
call "$vcvarsPath" >nul 2>&1
"$dumpbinPath" /dependents "$exePath"
"@
        $batFile = [System.IO.Path]::ChangeExtension($tempFile, ".bat")
        Set-Content -Path $batFile -Value $batContent
        $output = & cmd /c $batFile 2>&1
        Remove-Item $batFile -ErrorAction SilentlyContinue
        Remove-Item $tempFile -ErrorAction SilentlyContinue
        
        $dlls = $output | Where-Object { $_ -match "\.dll" -and $_ -notmatch "Image has the following dependencies" -and $_ -notmatch "^\s*$" }
        foreach ($dll in $dlls) {
            $dllName = $dll.Trim()
            if ($dllName -match "D\.dll$" -or $dllName -match "140D\.dll$") {
                Write-Host "  ⚠️  $dllName (Debug Runtime)" -ForegroundColor Yellow
            } else {
                Write-Host "  ✅ $dllName" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "⚠️  vcvars64.bat를 찾을 수 없습니다. Visual Studio Developer Command Prompt에서 직접 실행하세요:" -ForegroundColor Yellow
        Write-Host "   dumpbin /dependents `"$exePath`"" -ForegroundColor Cyan
    }
} else {
    Write-Host "⚠️  dumpbin을 찾을 수 없습니다. Visual Studio Developer Command Prompt에서 직접 실행하세요:" -ForegroundColor Yellow
    Write-Host "   dumpbin /dependents `"$exePath`"" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "---"
Write-Host ""

# 2. publish 폴더의 DLL 확인
Write-Host "[2] publish 폴더의 DLL 확인..." -ForegroundColor Yellow
Write-Host ""

$publishDir = Split-Path $exePath
$dllFiles = Get-ChildItem -Path $publishDir -Filter "*.dll" | Where-Object { $_.Name -notlike "*.resources.dll" }

Write-Host "발견된 DLL 파일:" -ForegroundColor Cyan
foreach ($dll in $dllFiles) {
    $size = [math]::Round($dll.Length / 1MB, 2)
    Write-Host "  - $($dll.Name) ($size MB)" -ForegroundColor White
}

Write-Host ""

# 3. 매니페스트 파일 확인
Write-Host "[3] 매니페스트 파일 확인..." -ForegroundColor Yellow
Write-Host ""

$manifestPath = Join-Path $publishDir "OnVoiceComBridge.exe.manifest"
if (Test-Path $manifestPath) {
    Write-Host "✅ 매니페스트 파일 발견: $manifestPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "매니페스트 내용:" -ForegroundColor Cyan
    Write-Host "---"
    Get-Content $manifestPath | Select-Object -First 30
    Write-Host "---"
} else {
    Write-Host "⚠️  매니페스트 파일을 찾을 수 없습니다: $manifestPath" -ForegroundColor Yellow
}

Write-Host ""

# 4. .NET 런타임 확인
Write-Host "[4] .NET 런타임 확인..." -ForegroundColor Yellow
Write-Host ""

$dotnetPath = "C:\Program Files\dotnet"
if (Test-Path $dotnetPath) {
    Write-Host "✅ .NET 설치 경로 발견: $dotnetPath" -ForegroundColor Green
    
    $runtimes = Get-ChildItem -Path "$dotnetPath\shared\Microsoft.NETCore.App" -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    if ($runtimes) {
        Write-Host ""
        Write-Host "설치된 .NET 런타임:" -ForegroundColor Cyan
        foreach ($runtime in $runtimes) {
            Write-Host "  - $($runtime.Name)" -ForegroundColor White
        }
    }
} else {
    Write-Host "⚠️  .NET 설치 경로를 찾을 수 없습니다: $dotnetPath" -ForegroundColor Yellow
}

Write-Host ""

# 5. sxstrace 사용 안내
Write-Host "[5] sxstrace를 사용한 상세 진단..." -ForegroundColor Yellow
Write-Host ""
Write-Host "관리자 권한으로 PowerShell을 실행한 후 다음 명령어를 실행하세요:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  # 1. 추적 시작" -ForegroundColor White
Write-Host "  sxstrace.exe Trace -logfile:sxstrace.etl" -ForegroundColor Green
Write-Host ""
Write-Host "  # 2. 다른 PowerShell 창에서 프로그램 실행" -ForegroundColor White
Write-Host "  & `"$exePath`"" -ForegroundColor Green
Write-Host ""
Write-Host "  # 3. 첫 번째 창에서 Ctrl+C로 추적 중지" -ForegroundColor White
Write-Host "  sxstrace.exe Parse -logfile:sxstrace.etl -outfile:sxstrace.txt" -ForegroundColor Green
Write-Host "  notepad sxstrace.txt" -ForegroundColor Green
Write-Host ""

Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host "진단 완료"
Write-Host "=" -NoNewline
Write-Host ("=" * 79)

