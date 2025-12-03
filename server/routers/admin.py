from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi import Request as FastAPIRequest
from pydantic import BaseModel
from db.supabase_client import supabase, get_app_setting
import logging

LOGGER = logging.getLogger("harmful-filter")

router = APIRouter(prefix="/admin", tags=["Admin"])


class SettingUpdate(BaseModel):
    key: str
    value: str


@router.post("/sync-settings")
async def sync_settings(payload: SettingUpdate):
    """
    관리자 대시보드에서 DB 값을 변경한 후, 이 API를 호출하여
    서버 메모리의 설정값(Threshold 등)을 즉시 동기화합니다.
    
    (실제 구현 시에는 Admin Token 검증이 필요합니다)
    """
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    
    # 1. DB에서 최신 값 확인
    db_value = get_app_setting(payload.key)
    if db_value is None:
        raise HTTPException(status_code=404, detail=f"Setting key '{payload.key}' not found")
    
    # 2. 서버 메모리 값 갱신
    # 예: app.state.classifier.threshold = float(db_value)
    # 주의: app 객체에 접근하려면 router에 app을 주입하거나 전역 상태 사용
    
    return {
        "status": "updated", 
        "key": payload.key, 
        "new_value": db_value
    }


@router.get("/logs")
async def get_detection_logs(
    request: FastAPIRequest,
    limit: int = Query(20, ge=1, le=100, description="가져올 로그 개수 (1-100)"),
    offset: int = Query(0, ge=0, description="시작 위치 (페이징용)"),
    only_harmful: bool = Query(False, description="유해한 것만 조회")
):
    """
    Supabase에서 감지 로그를 최신순으로 가져옵니다.
    
    - **limit**: 가져올 로그 개수 (기본값: 20, 최대: 100)
    - **offset**: 시작 위치 (페이징용, 기본값: 0)
    - **only_harmful**: true인 경우 유해한 로그만 조회 (기본값: false)
    
    **주의**: 현재는 인증이 없어서 누구나 로그를 볼 수 있습니다.
    Task 47(로그인) 완료 후 관리자만 접근 가능하도록 보안 강화 예정입니다.
    """
    # ✅ 요청 정보 로깅 (디버깅용)
    LOGGER.info(f"[Admin/Logs] 📥 요청 수신: limit={limit}, offset={offset}, only_harmful={only_harmful}")
    LOGGER.info(f"[Admin/Logs] 📋 요청 URL: {request.url}")
    LOGGER.info(f"[Admin/Logs] 📋 Origin: {request.headers.get('origin', 'N/A')}")
    LOGGER.info(f"[Admin/Logs] 📋 Referer: {request.headers.get('referer', 'N/A')}")
    LOGGER.info(f"[Admin/Logs] 📋 User-Agent: {request.headers.get('user-agent', 'N/A')}")
    # UUID 헤더 확인 (대시보드에서 전달하는 경우)
    uuid_header = request.headers.get('uuid') or request.headers.get('UUID') or request.headers.get('user-id')
    if uuid_header:
        LOGGER.info(f"[Admin/Logs] 📋 UUID 헤더 발견: {uuid_header}")
    else:
        LOGGER.info(f"[Admin/Logs] 📋 UUID 헤더 없음 (대시보드에서 전달하지 않음)")
    
    if not supabase:
        LOGGER.error("[Admin/Logs] ❌ Supabase 연결 실패")
        raise HTTPException(status_code=503, detail="Database connection failed")
    
    try:
        # 1. 쿼리 생성: detection_logs 테이블 선택
        query = supabase.table("detection_logs").select("*")
        
        # 2. 필터 적용: 유해한 것만 보고 싶은 경우
        if only_harmful:
            query = query.eq("is_harmful", True)
        
        # 3. 정렬 및 페이징: 최신순 정렬, 개수 제한
        # range(start, end)를 사용하여 페이징 처리
        LOGGER.info(f"[Admin/Logs] 🔍 DB 쿼리 실행 중...")
        response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        log_count = len(response.data) if response.data else 0
        LOGGER.info(f"[Admin/Logs] ✅ 로그 조회 성공: {log_count}개 로그 반환")
        
        return {
            "count": log_count,
            "logs": response.data if response.data else []
        }
        
    except Exception as e:
        LOGGER.error(f"[Admin/Logs] ❌ Failed to fetch logs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

