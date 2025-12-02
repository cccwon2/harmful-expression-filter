import os
from supabase import create_client, Client
from dotenv import load_dotenv
import logging

load_dotenv()

LOGGER = logging.getLogger("app")

url: str = os.getenv("SUPABASE_URL")
key: str = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    LOGGER.warning("⚠️ Supabase URL or Key is missing. Database features will be disabled.")
    supabase: Client = None
else:
    try:
        supabase: Client = create_client(url, key)
        LOGGER.info("✅ Supabase Client Initialized")
    except Exception as e:
        LOGGER.error(f"❌ Failed to initialize Supabase: {e}")
        supabase = None


async def save_detection_log(
    text: str,
    confidence: float,
    threshold: float,
    model: str,
    is_harmful: bool,
    user_id: str = None,
    filter_mode: str | None = None,
):
    """
    유해 표현 감지 로그를 비동기로 저장합니다.
    Main Thread를 차단하지 않기 위해 BackgroundTasks에서 호출되어야 합니다.
    """
    if not supabase:
        return
    
    try:
        data = {
            "text_content": text,
            "confidence": confidence,
            "threshold_used": threshold,
            "model_version": model,
            "is_harmful": is_harmful,
            "user_id": user_id,  # None이어도 저장 (DB에서 NULL 허용)
            "filter_mode": filter_mode,  # NULL 가능, 미지정 시 기본값(ocr)이 적용되도록 서버 쿼리에서 처리
        }
        
        LOGGER.info(f"📝 Supabase 로그 저장 시도: user_id={user_id}, text={text[:30]}..., is_harmful={is_harmful}")
        
        # execute()는 동기 함수지만, 별도 스레드 풀이나 BackgroundTasks 내부에서 실행 시 안전
        result = supabase.table("detection_logs").insert(data).execute()
        LOGGER.info(f"✅ Supabase 로그 저장 완료: user_id={user_id}, id={result.data[0]['id'] if result.data else 'N/A'}")
    except Exception as e:
        LOGGER.error(f"❌ Failed to save log to Supabase: {e}", exc_info=True)


def get_app_setting(key: str, default: str = None) -> str:
    """DB에서 특정 설정값을 가져옵니다."""
    if not supabase:
        return default
    
    try:
        response = supabase.table("app_settings").select("value").eq("key", key).execute()
        if response.data and len(response.data) > 0:
            return response.data[0]['value']
        return default
    except Exception as e:
        LOGGER.error(f"❌ Failed to fetch setting {key}: {e}")
        return default

