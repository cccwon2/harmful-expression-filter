"""
관리자 엔드포인트 테스트 스크립트
대시보드가 데이터를 가져올 수 있는지 확인
"""
import requests
import json

SERVER_URL = "http://127.0.0.1:8000"

def test_admin_logs():
    """관리자 로그 엔드포인트 테스트"""
    print("[Test] 관리자 로그 엔드포인트 테스트 시작")
    
    # 1. 헬스 체크
    try:
        print("\n[Test] 1. 헬스 체크...")
        response = requests.get(f"{SERVER_URL}/health", timeout=5)
        print(f"[Test] ✅ 헬스 체크 성공: {response.status_code}")
        print(f"[Test] 응답: {json.dumps(response.json(), indent=2, ensure_ascii=False)}")
    except Exception as e:
        print(f"[Test] ❌ 헬스 체크 실패: {e}")
        return
    
    # 2. 관리자 로그 엔드포인트 테스트
    try:
        print("\n[Test] 2. 관리자 로그 엔드포인트 테스트...")
        url = f"{SERVER_URL}/admin/logs"
        params = {
            "limit": 10,
            "offset": 0,
            "only_harmful": False
        }
        
        print(f"[Test] 요청 URL: {url}")
        print(f"[Test] 파라미터: {params}")
        
        response = requests.get(url, params=params, timeout=10)
        
        print(f"[Test] 상태 코드: {response.status_code}")
        print(f"[Test] 응답 헤더:")
        for key, value in response.headers.items():
            print(f"  {key}: {value}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\n[Test] ✅ 로그 조회 성공")
            print(f"[Test] 로그 개수: {data.get('count', 0)}")
            print(f"[Test] 로그 데이터 (처음 3개):")
            logs = data.get('logs', [])
            for i, log in enumerate(logs[:3]):
                print(f"  [{i+1}] {json.dumps(log, indent=4, ensure_ascii=False)}")
        else:
            print(f"\n[Test] ❌ 로그 조회 실패")
            print(f"[Test] 응답 내용: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print(f"\n[Test] ❌ 서버 연결 실패: 서버가 실행 중인지 확인하세요")
    except requests.exceptions.Timeout:
        print(f"\n[Test] ❌ 타임아웃: 서버 응답이 없습니다")
    except Exception as e:
        print(f"\n[Test] ❌ 오류 발생: {e}")
        import traceback
        traceback.print_exc()

def test_cors():
    """CORS 설정 확인"""
    print("\n[Test] 3. CORS 설정 확인...")
    try:
        # OPTIONS 요청으로 CORS 확인
        response = requests.options(
            f"{SERVER_URL}/admin/logs",
            headers={
                "Origin": "https://admin-dashboard-pi-seven-83.vercel.app",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "Content-Type"
            },
            timeout=5
        )
        
        print(f"[Test] OPTIONS 요청 상태 코드: {response.status_code}")
        print(f"[Test] CORS 헤더:")
        cors_headers = {
            "Access-Control-Allow-Origin": response.headers.get("Access-Control-Allow-Origin"),
            "Access-Control-Allow-Methods": response.headers.get("Access-Control-Allow-Methods"),
            "Access-Control-Allow-Headers": response.headers.get("Access-Control-Allow-Headers"),
        }
        for key, value in cors_headers.items():
            print(f"  {key}: {value}")
            
    except Exception as e:
        print(f"[Test] ❌ CORS 확인 실패: {e}")

if __name__ == "__main__":
    test_admin_logs()
    test_cors()
