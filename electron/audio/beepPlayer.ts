/**
 * Phase 5: 비프음 재생 모듈
 * 
 * 유해 표현 감지 시 비프음을 재생합니다.
 * 
 * 설치 필요:
 *   npm install howler
 */

// TODO: Howler.js 설치 후 주석 해제
// import { Howl } from 'howler';

export class BeepPlayer {
  private beepSound: any = null; // Howl 타입으로 변경 예정
  
  constructor() {
    // TODO: Howler.js 설치 후 구현
    // 비프음 파일 경로 (resources/ 폴더에 beep.mp3 추가)
    // this.beepSound = new Howl({
    //   src: ['resources/beep.mp3'],
    //   volume: 0.5
    // });
  }
  
  play(): void {
    // TODO: Howler.js 설치 후 구현
    // this.beepSound.play();
    console.log('[BeepPlayer] 🔔 Beep sound played (stub)');
  }
}

