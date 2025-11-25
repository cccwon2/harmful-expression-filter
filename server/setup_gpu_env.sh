#!/usr/bin/env bash
set -euo pipefail

###############################################
# 기본 설정 (필요하면 여기만 수정)
###############################################
PROJECT_ROOT="/opt/harmful-expression-filter/server"
PYTHON_BIN="python3.12"
VENV_DIR="${PROJECT_ROOT}/venv312"
REQ_FILE="${PROJECT_ROOT}/requirements-gpu.txt"

echo ">>> [0] 현재 설정 확인"
echo "    PROJECT_ROOT = ${PROJECT_ROOT}"
echo "    VENV_DIR     = ${VENV_DIR}"
echo

###############################################
# 1. 시스템 패키지 설치
###############################################
echo ">>> [1] 시스템 패키지 설치 (sudo 필요)"

sudo apt update
sudo apt install -y \
  ${PYTHON_BIN} \
  python3.12-venv \
  python3.12-dev \
  build-essential \
  git \
  ffmpeg \
  pkg-config

echo ">>>   - Python / 빌드툴 / ffmpeg 설치 완료"
echo

###############################################
# 2. 프로젝트 디렉토리 준비
###############################################
echo ">>> [2] 프로젝트 디렉토리 준비"

sudo mkdir -p "${PROJECT_ROOT}"
sudo chown -R "$(id -u):$(id -g)" "${PROJECT_ROOT}"

cd "${PROJECT_ROOT}"
echo ">>>   - 현재 디렉토리: $(pwd)"
echo

###############################################
# 3. GPU용 requirements 파일 생성 (이미 있으면 건너뜀)
###############################################
if [ -f "${REQ_FILE}" ]; then
  echo ">>> [3] ${REQ_FILE} 이미 존재 → 생성 단계 스킵"
else
  echo ">>> [3] ${REQ_FILE} 생성"

  cat << 'EOF' > "${REQ_FILE}"
# === FastAPI / 서버 ===
fastapi>=0.104.1
uvicorn[standard]>=0.24.0
pydantic>=2.10.4
python-multipart>=0.0.6

# === WebSocket ===
websockets>=12.0,<13.0

# === Env ===
python-dotenv>=1.0.0

# === Hugging Face / 훈련 스택 ===
transformers>=4.38.0
peft>=0.7.0
accelerate>=0.28.0
bitsandbytes>=0.46.1   # CUDA 13 드라이버 호환 릴리스 기준

# === Test ===
pytest
httpx
EOF

  echo ">>>   - ${REQ_FILE} 생성 완료"
fi
echo

###############################################
# 4. Python 3.12 venv (venv312) 생성
###############################################
echo ">>> [4] venv312 생성/갱신"

if [ -d "${VENV_DIR}" ]; then
  echo ">>>   - 기존 venv 발견: ${VENV_DIR}"
else
  echo ">>>   - 새 venv 생성: ${VENV_DIR}"
  ${PYTHON_BIN} -m venv "${VENV_DIR}"
fi
echo

###############################################
# 5. venv 활성화 + pip 업그레이드
###############################################
echo ">>> [5] venv 활성화 및 pip 업그레이드"

# shellcheck source=/dev/null
source "${VENV_DIR}/bin/activate"

python -m pip install --upgrade pip setuptools wheel

echo ">>>   - pip / setuptools / wheel 업그레이드 완료"
echo

###############################################
# 6. 공통 패키지 설치 (torch 제외)
###############################################
echo ">>> [6] requirements-gpu.txt 설치 (torch 제외)"

pip install -r "${REQ_FILE}"

echo ">>>   - requirements-gpu.txt 설치 완료"
echo

###############################################
# 7. PyTorch + CUDA (cu124 wheel 사용)
###############################################
echo ">>> [7] PyTorch (CUDA 12.4 wheel) 설치"
echo ">>>   - 공식 문서 기준 v2.4.1 + cu124 wheel 사용"
echo ">>>   - 필요시 버전은 나중에 직접 조정 가능"

pip install \
  torch==2.4.1 \
  torchvision==0.19.1 \
  torchaudio==2.4.1 \
  --index-url https://download.pytorch.org/whl/cu124

echo ">>>   - PyTorch + CUDA wheel 설치 완료"
echo

###############################################
# 8. 간단한 GPU 동작 체크
###############################################
echo ">>> [8] PyTorch + CUDA + bitsandbytes 점검"

python - << 'EOF'
import sys
import textwrap

print("=" * 60)
print("Python 정보")
print("-" * 60)
print(sys.version)
print()

try:
    import torch
    print("Torch 버전:", torch.__version__)
    print("Torch CUDA 빌드:", torch.version.cuda)
    print("CUDA 사용 가능 여부 (torch.cuda.is_available):", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("  - GPU 이름:", torch.cuda.get_device_name(0))
    else:
        print("  [경고] CUDA 사용 불가. 드라이버/런타임 확인 필요.")
except Exception as e:
    print("[에러] torch import 또는 CUDA 체크 실패:", e)

print()
print("=" * 60)
print("bitsandbytes 점검")
print("-" * 60)
try:
    import bitsandbytes as bnb
    print("bitsandbytes 버전:", bnb.__version__)
    print("bitsandbytes import 성공")
except Exception as e:
    print("[경고] bitsandbytes import 실패:", e)
    print("  - CUDA 버전 / 라이브러리 / LD_LIBRARY_PATH 등을 확인하세요.")
print("=" * 60)
EOF

echo
echo ">>> [완료] venv312 + GPU 환경 세팅이 끝났습니다!"
echo ">>> 다음부터는 아래 명령으로 활성화해서 사용하세요:"
echo
echo "    cd ${PROJECT_ROOT}"
echo "    source venv312/bin/activate"
echo
