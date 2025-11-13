/**
 * T26 Phase 1: native-sound-mixer 설치 테스트
 * 
 * 실행 방법:
 *   npx tsx electron/test/test_native_sound_mixer.ts
 */

import soundMixer, { DeviceType } from 'native-sound-mixer';
import { AppVolumeController } from '../audio/appVolumeController';

function testInstallation() {
  console.log('🔍 Testing native-sound-mixer installation...\n');
  
  try {
    // 기본 출력 디바이스 가져오기
    const defaultDevice = soundMixer.getDefaultDevice(DeviceType.RENDER);
    
    if (defaultDevice) {
      console.log(`✅ Default output device: ${defaultDevice.name}`);
      
      // AppVolumeController를 사용하여 오디오 세션 조회
      const volumeController = new AppVolumeController();
      const sessions = volumeController.getAudioSessions();
      
      console.log(`✅ Active audio sessions: ${sessions.length}`);
      sessions.forEach((s) => {
        console.log(`   - ${s.name} (${s.appName}) - Vol: ${Math.round(s.volume * 100)}%`);
      });
      
      console.log('\n✅ Installation test passed!');
    } else {
      console.warn('⚠️ No default output device found');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Installation test failed:', err);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Install Visual Studio Build Tools');
    console.log('   2. Run: npm rebuild native-sound-mixer');
    console.log('   3. Restart terminal');
    process.exit(1);
  }
}

testInstallation();

