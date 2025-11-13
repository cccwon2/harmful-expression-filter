/**
 * T26 Phase 1: native-sound-mixer 설치 테스트
 * 
 * 실행 방법:
 *   npx tsx electron/test/test_native_sound_mixer.ts
 */

import * as soundMixer from 'native-sound-mixer';

function testInstallation() {
  console.log('🔍 Testing native-sound-mixer installation...\n');
  
  try {
    const devices = soundMixer.getDevices();
    console.log(`✅ Found ${devices.length} audio devices`);
    
    const defaultOutput = devices.find((d: any) => d.type === 'render' && d.isDefault);
    if (defaultOutput) {
      console.log(`✅ Default output: ${defaultOutput.name}`);
      
      const sessions = soundMixer.getAudioSessions(defaultOutput.id);
      console.log(`✅ Active audio sessions: ${sessions.length}`);
      sessions.forEach((s: any) => {
        console.log(`   - ${s.name} (Vol: ${Math.round(s.volume * 100)}%)`);
      });
    } else {
      console.warn('⚠️ No default output device found');
    }
    
    console.log('\n✅ Installation test passed!');
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

