@echo off
REM Task 50: 테스트 자동화 빠른 시작 스크립트 (Windows)
REM 목적: 한 번의 실행으로 테스트 환경 구축 및 테스트 실행

echo ========================================
echo Task 50: 테스트 자동화 빠른 시작
echo ========================================
echo.

REM 1. Node.js 버전 확인
echo [1/7] Node.js 버전 확인 중...
node --version
if errorlevel 1 (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo Node.js 16.x 이상이 필요합니다.
    pause
    exit /b 1
)
echo.

REM 2. 패키지 설치
echo [2/7] npm 패키지 설치 중...
call npm install
if errorlevel 1 (
    echo [오류] 패키지 설치에 실패했습니다.
    pause
    exit /b 1
)
echo.

REM 3. Playwright 브라우저 설치
echo [3/7] Playwright 브라우저 설치 중...
call npx playwright install --with-deps
if errorlevel 1 (
    echo [경고] Playwright 브라우저 설치에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다.
)
echo.

REM 4. 앱 빌드 (E2E 테스트용)
echo [4/7] 앱 빌드 중 (E2E 테스트용)...
echo 이 단계는 시간이 걸릴 수 있습니다...
call npm run build:all
if errorlevel 1 (
    echo [경고] 앱 빌드에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다.
) else (
    call npm run build:renderer
    if errorlevel 1 (
        echo [경고] 렌더러 빌드에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다.
    )
)
echo.

REM 5. 유닛 테스트 실행
echo [5/7] 유닛 테스트 실행 중...
call npm run test:unit
if errorlevel 1 (
    echo [오류] 유닛 테스트가 실패했습니다.
    echo 계속 진행하시겠습니까? (Y/N)
    set /p continue=
    if /i not "%continue%"=="Y" (
        pause
        exit /b 1
    )
)
echo.

REM 6. E2E 테스트 실행 (선택)
echo [6/7] E2E 테스트 실행 (선택)
echo E2E 테스트를 실행하시겠습니까? (Y/N)
set /p run_e2e=
if /i "%run_e2e%"=="Y" (
    echo E2E 테스트 실행 중...
    call npm run test:e2e
    if errorlevel 1 (
        echo [경고] E2E 테스트 중 일부가 실패했습니다.
    )
) else (
    echo E2E 테스트를 건너뜁니다.
)
echo.

REM 7. 테스트 리포트 열기 (선택)
echo [7/7] 테스트 리포트
echo 테스트 리포트를 열까요? (Y/N)
set /p open_report=
if /i "%open_report%"=="Y" (
    echo 테스트 리포트 열기 중...
    call npm run test:report
)

echo.
echo ========================================
echo 테스트 자동화 빠른 시작 완료!
echo ========================================
echo.
echo 다음 명령어로 테스트를 실행할 수 있습니다:
echo   - 유닛 테스트: npm run test:unit
echo   - E2E 테스트: npm run test:e2e
echo   - 전체 테스트: npm test
echo   - 리포트 보기: npm run test:report
echo.
pause

