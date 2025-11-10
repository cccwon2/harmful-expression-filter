import json
import sys
import urllib.parse
import urllib.request


def call(endpoint: str, payload: dict | None = None):
    data = None

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"http://127.0.0.1:8000{endpoint}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if data is not None else "GET",
    )

    with urllib.request.urlopen(request) as response:
        print(response.read().decode("utf-8"))


if __name__ == "__main__":
    if len(sys.argv) == 1:
        print(">>> POST /analyze (clean)")
        call("/analyze", {"text": "안녕하세요 반갑습니다", "use_ai": False})
        print(">>> POST /analyze (violation)")
        call("/analyze", {"text": "욕설 비방 혐오", "use_ai": False})
        print(">>> GET /test")
        text_param = urllib.parse.quote("욕설테스트", safe="")
        with urllib.request.urlopen(f"http://127.0.0.1:8000/test?text={text_param}") as response:
            print(response.read().decode("utf-8"))
    else:
        endpoint = sys.argv[1]
        payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
        call(endpoint, payload)

