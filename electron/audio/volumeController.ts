/**
 * Phase 5: Windows 볼륨 제어 모듈
 * 
 * 유해 표현 감지 시 시스템 볼륨을 조절합니다.
 * 
 * 설치 필요:
 *   npm install loudness
 */

// TODO: loudness 패키지 설치 후 주석 해제
// import loudness from 'loudness';

export class VolumeController {
  private originalVolume: number = 50;
  private isAdjusted: boolean = false;
  
  async saveCurrentVolume(): Promise<void> {
    // TODO: loudness 패키지 설치 후 구현
    // this.originalVolume = await loudness.getVolume();
    console.log(`[VolumeController] 📊 Current volume saved: ${this.originalVolume}`);
  }
  
  async adjustVolume(level: number): Promise<void> {
    // level: 0~10 → volume: 0~100
    const targetVolume = level * 10;
    await this.saveCurrentVolume();
    
    // TODO: loudness 패키지 설치 후 구현
    // await loudness.setVolume(targetVolume);
    this.isAdjusted = true;
    console.log(`[VolumeController] 🔊 Volume adjusted to: ${targetVolume}`);
    
    // 3초 후 원래 볼륨으로 복원
    setTimeout(async () => {
      await this.restoreVolume();
    }, 3000);
  }
  
  async restoreVolume(): Promise<void> {
    if (this.isAdjusted) {
      // TODO: loudness 패키지 설치 후 구현
      // await loudness.setVolume(this.originalVolume);
      this.isAdjusted = false;
      console.log(`[VolumeController] 🔊 Volume restored to: ${this.originalVolume}`);
    }
  }
}

