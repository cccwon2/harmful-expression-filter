"""
Phase 1 WebSocket 엔드포인트 테스트.
"""

from starlette.testclient import TestClient

from main import app


def test_audio_websocket_echo() -> None:
    """
    Phase 1에서 구현할 /ws/audio WebSocket 엔드포인트의
    바이너리 수신 및 응답(JSON) 동작을 검증한다.
    """
    client = TestClient(app)

    with client.websocket_connect("/ws/audio") as websocket:
        # 연결 시 초기 메시지(텍스트) 수신 확인
        welcome_message = websocket.receive_text()
        assert welcome_message == "Connected", "연결 환영 메시지가 누락되었습니다."

        # 임의의 바이너리 오디오 데이터 전송
        sample_bytes = b"\x00\x01\x02\x03"
        websocket.send_bytes(sample_bytes)

        # 서버가 JSON 응답으로 에코 상태를 반환하는지 확인
        response = websocket.receive_json()
        assert response["status"] == "received"
        assert response["size"] == len(sample_bytes)


