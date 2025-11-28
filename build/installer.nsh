!macro customInstall
  ; 설치 과정 중 실행됨
  DetailPrint "Registering OnVoiceAudioBridge DLL..."
  
  ; 64비트 레지스트리 뷰 설정 (64비트 앱인 경우 필수)
  SetRegView 64
  
  ; DLL 등록 (관리자 권한 필요)
  RegDLL "$INSTDIR\resources\native\OnVoiceAudioBridge.dll"
!macroend

!macro customUnInstall
  ; 제거 과정 중 실행됨
  DetailPrint "Unregistering OnVoiceAudioBridge DLL..."
  
  SetRegView 64
  
  ; DLL 등록 해제
  UnRegDLL "$INSTDIR\resources\native\OnVoiceAudioBridge.dll"
!macroend
