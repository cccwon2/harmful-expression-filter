#!/bin/bash
# Task 50: 테스트 자동화 빠른 시작 스크립트 (Linux/Mac)
# 목적: 한 번의 실행으로 테스트 환경 구축 및 테스트 실행

set -e

echo "========================================"
echo "Task 50: 테스트 자동화 빠른 시작"
echo "========================================"
echo ""

# 1. Node.js 버전 확인
echo "[1/7] Node.js 버전 확인 중..."
if ! command -v node &> /dev/null; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    echo "Node.js 16.x 이상이 필요합니다."
    exit 1
fi
node --version
echo ""

# 2. 패키지 설치
echo "[2/7] npm 패키지 설치 중..."
npm install
if [ $? -ne 0 ]; then
    echo "[오류] 패키지 설치에 실패했습니다."
    exit 1
fi
echo ""

# 3. Playwright 브라우저 설치
echo "[3/7] Playwright 브라우저 설치 중..."
npx playwright install --with-deps || {
    echo "[경고] Playwright 브라우저 설치에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다."
}
echo ""

# 4. 앱 빌드 (E2E 테스트용)
echo "[4/7] 앱 빌드 중 (E2E 테스트용)..."
echo "이 단계는 시간이 걸릴 수 있습니다..."
npm run build:all || {
    echo "[경고] 앱 빌드에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다."
}

npm run build:renderer || {
    echo "[경고] 렌더러 빌드에 실패했습니다. E2E 테스트가 작동하지 않을 수 있습니다."
}
echo ""

# 5. 유닛 테스트 실행
echo "[5/7] 유닛 테스트 실행 중..."
npm run test:unit || {
    echo "[오류] 유닛 테스트가 실패했습니다."
    echo "계속 진행하시겠습니까? (y/n)"
    read -r continue
    if [ "$continue" != "y" ] && [ "$continue" != "Y" ]; then
        exit 1
    fi
}
echo ""

# 6. E2E 테스트 실행 (선택)
echo "[6/7] E2E 테스트 실행 (선택)"
echo "E2E 테스트를 실행하시겠습니까? (y/n)"
read -r run_e2e
if [ "$run_e2e" = "y" ] || [ "$run_e2e" = "Y" ]; then
    echo "E2E 테스트 실행 중..."
    npm run test:e2e || {
        echo "[경고] E2E 테스트 중 일부가 실패했습니다."
    }
else
    echo "E2E 테스트를 건너뜁니다."
fi
echo ""

# 7. 테스트 리포트 열기 (선택)
echo "[7/7] 테스트 리포트"
echo "테스트 리포트를 열까요? (y/n)"
read -r open_report
if [ "$open_report" = "y" ] || [ "$open_report" = "Y" ]; then
    echo "테스트 리포트 열기 중..."
    npm run test:report
fi

echo ""
echo "========================================"
echo "테스트 자동화 빠른 시작 완료!"
echo "========================================"
echo ""
echo "다음 명령어로 테스트를 실행할 수 있습니다:"
echo "  - 유닛 테스트: npm run test:unit"
echo "  - E2E 테스트: npm run test:e2e"
echo "  - 전체 테스트: npm test"
echo "  - 리포트 보기: npm run test:report"
echo ""

