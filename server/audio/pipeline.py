"""
Phase 4: [NEW] Real-time Streaming Pipeline
기존의 청크 기반 버퍼링 방식을 제거하고, Deepgram WebSocket을 통한 실시간 스트리밍으로 대체했습니다.
지연 시간(Latency)이 0.5초 이내로 단축됩니다.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Optional

from dotenv import load_dotenv
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

# 로거 설정
LOGGER = logging.getLogger("harmful-filter")

# .env 파일 로드
load_dotenv()
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

class AudioProcessingPipeline:
    """
    Deepgram WebSocket을 이용한 초저지연 실시간 유해 표현 감지 파이프라인.
    
    특징:
    1. 버퍼링 없이 오디오 패킷을 즉시 전송합니다.
    2. 문장이 완성되지 않아도 중간 결과(Interim Results)를 받아 감지합니다.
    3. 별도의 STT Service 클래스 없이 이 클래스가 직접 Deepgram과 통신합니다.
    """

    def __init__(
        self,
        keywords: Optional[list[str]] = None,
    ) -> None:
        if not DEEPGRAM_API_KEY:
            LOGGER.error("DEEPGRAM_API_KEY is missing in .env file")
            raise ValueError("DEEPGRAM_API_KEY가 설정되지 않았습니다.")

        self.api_key = DEEPGRAM_API_KEY
        # 🔇 키워드 리스트 주석처리 (kanana-lora-v1 모델만 사용)
        # self.keywords = keywords or ["새끼", "쉐끼", "시끼", "시발", "씨발", "병신", "존나", "미친", "니미", "좆", "도 아니고"]
        self.keywords = []
        
        # Deepgram 클라이언트 및 연결 객체
        self.dg_client = DeepgramClient(self.api_key)
        self.dg_connection = None
        self.is_running = False
        
        # 비동기 전송을 위한 큐 (Electron -> Python -> Deepgram)
        self.audio_queue = asyncio.Queue()

    async def start(self):
        """Deepgram WebSocket 연결을 시작합니다."""
        try:
            # 1. 연결 객체 생성
            self.dg_connection = self.dg_client.listen.live.v("1")

            # 2. 이벤트 핸들러 등록
            self.dg_connection.on(LiveTranscriptionEvents.Transcript, self._on_message)
            self.dg_connection.on(LiveTranscriptionEvents.Error, self._on_error)
            # self.dg_connection.on(LiveTranscriptionEvents.Close, self._on_close)

            # 3. 옵션 설정 (Electron 오디오 포맷과 일치 필수: Linear16, 16kHz)
            options = LiveOptions(
                model="nova-2",      # 가장 성능 좋은 모델
                language="ko",       # 한국어
                smart_format=True,   # 구두점 자동 추가
                encoding="linear16", # Raw PCM (Int16)
                channels=1,          # 모노
                sample_rate=16000,   # 16kHz
                interim_results=True # ✨ 핵심: 문장이 안 끝나도 결과를 받음 (속도 향상)
            )

            LOGGER.info("[Deepgram] 🚀 WebSocket Connecting...")
            print("[Deepgram] 🚀 WebSocket 연결 시도 중...", flush=True)

            # 4. 연결 시작
            if self.dg_connection.start(options) is False:
                LOGGER.error("[Deepgram] ❌ Connection Failed")
                return False

            self.is_running = True
            LOGGER.info("[Deepgram] ✅ Real-time Streaming Started (Latency < 0.5s)")
            print("[Deepgram] ✅ 실시간 스트리밍 시작됨", flush=True)

            # 5. 큐 처리 태스크 시작
            asyncio.create_task(self._process_audio_queue())
            return True

        except Exception as e:
            LOGGER.error(f"[Deepgram] Start Error: {e}")
            return False

    async def stop(self):
        """파이프라인 종료"""
        self.is_running = False
        if self.dg_connection:
            self.dg_connection.finish()
            LOGGER.info("[Deepgram] Connection Closed")

    async def process_audio(self, audio_bytes: bytes) -> None:
        """
        외부(main.py)에서 호출하는 메서드.
        받은 오디오를 즉시 큐에 넣습니다. (Non-blocking)
        """
        if not self.is_running or not audio_bytes:
            return

        # 큐에 오디오 데이터 투입
        # put_nowait을 사용하여 이벤트 루프를 막지 않음
        try:
            self.audio_queue.put_nowait(audio_bytes)
        except asyncio.QueueFull:
            pass # 큐가 꽉 차면 패킷 드랍 (실시간성 유지 위함)

    async def _process_audio_queue(self):
        """큐에 쌓인 데이터를 Deepgram으로 전송하는 내부 루프"""
        while self.is_running:
            try:
                data = await self.audio_queue.get()
                self.dg_connection.send(data)
            except Exception as e:
                LOGGER.error(f"[Sender] Error: {e}")
                break

    def _on_message(self, result, **kwargs):
        """Deepgram에서 텍스트가 수신되면 호출되는 콜백"""
        try:
            # 텍스트 추출
            alternatives = result.channel.alternatives
            if not alternatives:
                return
            
            transcript = alternatives[0].transcript
            if len(transcript.strip()) == 0:
                return

            is_final = result.is_final
            status_tag = "[확정]" if is_final else "[진행]"
            
            # 콘솔 출력 (디버깅용)
            print(f"[STT] {status_tag} {transcript}", flush=True)

            # 🔥 유해 표현 감지
            self._check_harmful(transcript, alternatives[0].confidence)

        except Exception as e:
            LOGGER.error(f"[Handler] Message Error: {e}")

    def _check_harmful(self, text: str, confidence: float):
        """🔇 키워드 매칭 비활성화 (kanana-lora-v1 모델만 사용)"""
        # 키워드 기반 분석 비활성화 - 서버의 AI 모델만 사용
        # detected = [word for word in self.keywords if word in text]
        # 
        # if detected:
        #     msg = f"🚨 유해 표현 감지: '{text}' (키워드: {detected}, 정확도: {confidence:.2f})"
        #     print(f"\n{msg}\n", flush=True)
        #     LOGGER.warning(msg)
        #     
        #     # TODO: 여기서 Electron으로 알림을 보내는 코드를 추가할 수 있습니다.
        #     # 예: send_socket_alert(detected)
        pass

    def _on_error(self, error, **kwargs):
        LOGGER.error(f"[Deepgram] Error: {error}")