"""
테스트 스크립트: user_id Header 전달 및 DB 저장 테스트
"""
import requests
import json

SERVER_URL = "http://127.0.0.1:8000"
TEST_USER_ID = "test-uuid-12345-67890"

def test_analyze_endpoint():
    """/analyze 엔드포인트 테스트"""
    print("=" * 60)
    print("테스트 1: /analyze 엔드포인트 (유해 표현 포함)")
    print("=" * 60)
    
    url = f"{SERVER_URL}/analyze"
    headers = {
        "Content-Type": "application/json",
        "user_id": TEST_USER_ID,
    }
    payload = {
        "text": "욕설 테스트",
        "user_id": None,  # Header에서 가져오기 위해 None
        "filter_mode": "ocr",
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        print(f"\n✅ 요청 성공! 서버 로그를 확인하세요:")
        print(f"   - Header의 user_id: {TEST_USER_ID}")
        print(f"   - 응답을 확인하고 서버 콘솔에서 'Supabase 로그 저장' 메시지를 찾으세요.")
    except requests.exceptions.ConnectionError:
        print("❌ 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.")
    except Exception as e:
        print(f"❌ 오류 발생: {e}")

def test_ocr_and_analyze_endpoint():
    """/api/ocr-and-analyze 엔드포인트 테스트 (실제 이미지 필요)"""
    print("\n" + "=" * 60)
    print("테스트 2: /api/ocr-and-analyze 엔드포인트")
    print("=" * 60)
    print("⚠️  이 테스트는 실제 이미지 파일이 필요합니다.")
    print("   이미지 파일이 있다면 테스트를 진행할 수 있습니다.\n")
    
    # 간단한 테스트 이미지 생성 (PIL 사용)
    try:
        from PIL import Image
        import io
        
        # 작은 테스트 이미지 생성
        img = Image.new('RGB', (100, 100), color='white')
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        
        url = f"{SERVER_URL}/api/ocr-and-analyze"
        headers = {
            "user_id": TEST_USER_ID,
        }
        files = {
            "file": ("test.png", img_bytes, "image/png")
        }
        
        response = requests.post(url, files=files, headers=headers, timeout=30)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
            print(f"\n✅ 요청 성공! 서버 로그를 확인하세요:")
            print(f"   - Header의 user_id: {TEST_USER_ID}")
        else:
            print(f"Response: {response.text}")
    except ImportError:
        print("⚠️  PIL/Pillow가 설치되지 않아 이미지 테스트를 건너뜁니다.")
    except Exception as e:
        print(f"❌ 오류 발생: {e}")

def test_server_health():
    """서버 상태 확인"""
    print("\n" + "=" * 60)
    print("테스트 0: 서버 상태 확인")
    print("=" * 60)
    
    try:
        response = requests.get(f"{SERVER_URL}/health", timeout=5)
        print(f"Status Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
        print("✅ 서버가 정상적으로 실행 중입니다.\n")
        return True
    except requests.exceptions.ConnectionError:
        print("❌ 서버에 연결할 수 없습니다.")
        print("   서버를 먼저 실행하세요: cd server && python -m uvicorn main:app --reload")
        return False
    except Exception as e:
        print(f"❌ 오류 발생: {e}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("user_id Header 및 DB 저장 테스트")
    print("=" * 60)
    print(f"서버 URL: {SERVER_URL}")
    print(f"테스트 UUID: {TEST_USER_ID}\n")
    
    # 서버 상태 확인
    if test_server_health():
        # 테스트 실행
        test_analyze_endpoint()
        test_ocr_and_analyze_endpoint()
        
        print("\n" + "=" * 60)
        print("테스트 완료!")
        print("=" * 60)
        print("\n서버 콘솔에서 다음 로그를 확인하세요:")
        print("  1. '[Analyze] 📥 분석 요청 수신: ..., user_id Header=...'")
        print("  2. '[Analyze] 🔍 user_id 추출: Header=..., 최종=...'")
        print("  3. '📝 Supabase 로그 저장 시도: user_id=...'")
        print("  4. '✅ Supabase 로그 저장 완료: user_id=..., id=...'")
        print("\n만약 'Supabase 로그 저장' 메시지가 보이지 않는다면:")
        print("  - 유해 표현이 감지되지 않았을 수 있습니다.")
        print("  - 서버 로그 레벨을 확인하세요.")
        print("  - Supabase 연결 상태를 확인하세요.")

