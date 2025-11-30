# COM DLL 등록 스크립트
# 
# 실행 방법:
#   PowerShell에서: .\scripts\register-com-dll.ps1
#   또는 관리자 권한으로: .\scripts\register-com-dll.ps1

$dllPath = Join-Path $PSScriptRoot "..\native\OnVoiceAudioBridge.dll"

Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host "COM DLL 등록"
Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host ""

if (-not (Test-Path $dllPath)) {
    Write-Host "❌ DLL을 찾을 수 없습니다: $dllPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "해결 방법:" -ForegroundColor Yellow
    Write-Host "  1. C++ 프로젝트를 Release 모드로 빌드: npm run build:native"
    Write-Host "  2. DLL 복사: npm run copy:native"
    exit 1
}

Write-Host "✅ DLL 발견: $dllPath" -ForegroundColor Green
Write-Host ""

# 현재 등록 상태 확인
Write-Host "[1] 현재 등록 상태 확인..." -ForegroundColor Yellow
try {
    $result = reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture" /ve 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ COM DLL이 이미 등록되어 있습니다." -ForegroundColor Green
        Write-Host ""
        Write-Host "등록 정보:" -ForegroundColor Cyan
        $result | ForEach-Object { Write-Host "  $_" }
        Write-Host ""
        Write-Host "등록을 해제하고 다시 등록하시겠습니까? (Y/N)" -ForegroundColor Yellow
        $response = Read-Host
        if ($response -eq "Y" -or $response -eq "y") {
            Write-Host ""
            Write-Host "[2] 기존 등록 해제..." -ForegroundColor Yellow
            regsvr32.exe /s /u "$dllPath"
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ 등록 해제 완료" -ForegroundColor Green
            } else {
                Write-Host "⚠️  등록 해제 실패 (계속 진행)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "등록을 건너뜁니다." -ForegroundColor Yellow
            exit 0
        }
    } else {
        Write-Host "⚠️  COM DLL이 등록되어 있지 않습니다." -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️  등록 상태 확인 실패: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[3] COM DLL 등록 시도..." -ForegroundColor Yellow

# 관리자 권한 확인
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  관리자 권한이 필요할 수 있습니다." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "관리자 권한으로 PowerShell을 실행한 후 다시 시도하세요:" -ForegroundColor Cyan
    Write-Host "  1. PowerShell을 마우스 오른쪽 클릭"
    Write-Host "  2. '관리자 권한으로 실행' 선택"
    Write-Host "  3. 이 스크립트 다시 실행"
    Write-Host ""
    Write-Host "또는 수동으로 등록:" -ForegroundColor Cyan
    Write-Host "  regsvr32.exe `"$dllPath`""
    Write-Host ""
}

# 등록 시도
regsvr32.exe /s "$dllPath"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ COM DLL 등록 성공" -ForegroundColor Green
    Write-Host ""
    
    # 등록 확인
    Write-Host "[4] 등록 확인..." -ForegroundColor Yellow
    try {
        $result = reg query "HKEY_CLASSES_ROOT\OnVoiceAudioBridge.OnVoiceCapture" /ve 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ 등록 확인됨" -ForegroundColor Green
            Write-Host ""
            Write-Host "등록 정보:" -ForegroundColor Cyan
            $result | ForEach-Object { Write-Host "  $_" }
        } else {
            Write-Host "⚠️  등록 확인 실패 (등록은 성공했을 수 있음)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "⚠️  등록 확인 실패: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ COM DLL 등록 실패" -ForegroundColor Red
    Write-Host ""
    Write-Host "해결 방법:" -ForegroundColor Yellow
    Write-Host "  1. 관리자 권한으로 PowerShell 실행"
    Write-Host "  2. 수동 등록: regsvr32.exe `"$dllPath`""
    Write-Host "  3. Visual C++ Redistributable 설치 확인"
    exit 1
}

Write-Host ""
Write-Host "=" -NoNewline
Write-Host ("=" * 79)
Write-Host "등록 완료"
Write-Host "=" -NoNewline
Write-Host ("=" * 79)

