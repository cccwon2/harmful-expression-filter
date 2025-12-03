"""
간단한 user_id Header 테스트 스크립트
서버가 실행 중일 때만 작동합니다.
"""
import requests
import json

SERVER_URL = "http://127.0.0.1:8000"
TEST_USER_ID = "test-uuid-12345-67890"

def test_analyze_with_harmful_text():
    """유해 텍스트로 /analyze 엔드포인트 테스트"""
    print("=" * 60)
    print("테스트: /analyze 엔드포인트 (유해 표현 포함)")
    print("=" * 60)
    
    url = f"{SERVER_URL}/analyze"
    headers = {
        "Content-Type": "application/json",
        "user_id": TEST_USER_ID,  # Header에 user_id 추가
    }
    payload = {
        "text": "욕설 테스트",  # 유해 표현
        "filter_mode": "ocr",
    }
    
    try:
        print(f"\n요청 전송 중...")
        print(f"  URL: {url}")
        print(f"  Headers: user_id={TEST_USER_ID}")
        print(f"  Payload: {payload}")
        
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"\n응답 받음:")
        print(f"  Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"  Response: {json.dumps(result, indent=2, ensure_ascii=False)}")
            print(f"\n✅ 요청 성공!")
            print(f"\n서버 콘솔에서 다음 로그를 확인하세요:")
            print(f"  1. '[Analyze] 📥 분석 요청 수신: ..., user_id Header={TEST_USER_ID}'")
            print(f"  2. '[Analyze] 🔍 로그 저장 조건 확인: ...'")
            print(f"  3. '[Analyze] 🔍 user_id 추출: Header={TEST_USER_ID}, ...'")
            print(f"  4. '📝 [Supabase] 로그 저장 시도 시작: user_id={TEST_USER_ID}, ...'")
            print(f"  5. '✅ [Supabase] 로그 저장 완료: user_id={TEST_USER_ID}, id=...'")
        else:
            print(f"  Error: {response.text}")
    except requests.exceptions.ConnectionError:
        print("\n❌ 서버에 연결할 수 없습니다.")
        print("   서버를 먼저 실행하세요:")
        print("   cd server")
        print("   .\\venv312\\Scripts\\python.exe -m uvicorn main:app --reload")
    except Exception as e:
        print(f"\n❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("=" * 60)
    print("user_id Header 및 DB 저장 테스트")
    print("=" * 60)
    print(f"서버 URL: {SERVER_URL}")
    print(f"테스트 UUID: {TEST_USER_ID}\n")
    
    test_analyze_with_harmful_text()

