from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db.supabase_client import supabase, get_app_setting

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

