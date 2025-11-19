/**
 * 서버 연결 테스트 스크립트
 * 실행 방법: npx tsx electron/test/test_server_connection.ts
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

// .env 파일 로드
const envPath = path.join(__dirname, '../../.env');
dotenv.config({ path: envPath });

const SERVER_URL = process.env.SERVER_URL || 'http://127.0.0.1:8000';

async function testServerConnection() {
  console.log('='.repeat(60));
  console.log('서버 연결 테스트');
  console.log('='.repeat(60));
  console.log(`환경 변수 SERVER_URL: ${process.env.SERVER_URL || '(설정 안 됨)'}`);
  console.log(`사용할 서버 URL: ${SERVER_URL}`);
  console.log(`.env 파일 경로: ${envPath}`);
  console.log();

  // 1. 기본 연결 테스트
  console.log('[테스트 1] 기본 연결 테스트...');
  try {
    const response = await axios.get(`${SERVER_URL}/health`, {
      timeout: 5000,
      validateStatus: (status) => status < 500, // 500 이상만 에러로 처리
    });
    console.log(`✅ 연결 성공: HTTP ${response.status}`);
    console.log(`   응답 데이터:`, JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error(`❌ 연결 실패`);
    if (axios.isAxiosError(error)) {
      console.error(`   메시지: ${error.message}`);
      console.error(`   코드: ${error.code}`);
      console.error(`   요청 URL: ${error.config?.url}`);
      if (error.code === 'ECONNREFUSED') {
        console.error(`   ⚠️ 서버가 실행되지 않았습니다.`);
        console.error(`   해결 방법: server 폴더에서 서버를 실행하세요.`);
        console.error(`   예: cd server && venv311\\Scripts\\activate && uvicorn main:app --reload`);
      }
      if (error.code === 'ETIMEDOUT') {
        console.error(`   ⚠️ 연결 타임아웃 - 서버가 응답하지 않습니다.`);
      }
      if (error.response) {
        console.error(`   HTTP 상태: ${error.response.status}`);
        console.error(`   응답 데이터:`, JSON.stringify(error.response.data, null, 2));
      }
    } else {
      console.error(`   알 수 없는 오류:`, error);
    }
    process.exit(1);
  }

  // 2. OCR 엔드포인트 테스트
  console.log();
  console.log('[테스트 2] OCR 엔드포인트 존재 확인...');
  try {
    // 빈 요청으로 400 에러가 나오는지 확인 (엔드포인트는 존재함)
    const response = await axios.post(
      `${SERVER_URL}/api/ocr-and-analyze`,
      {},
      {
        timeout: 5000,
        validateStatus: () => true, // 모든 상태 코드 허용
      }
    );
    console.log(`✅ 엔드포인트 접근 가능: HTTP ${response.status}`);
    if (response.status === 400 || response.status === 422) {
      console.log(`   (400/422는 정상 - 파일이 없어서 발생한 에러)`);
    }
  } catch (error: any) {
    console.error(`❌ 엔드포인트 접근 실패`);
    if (axios.isAxiosError(error)) {
      console.error(`   메시지: ${error.message}`);
      console.error(`   코드: ${error.code}`);
    } else {
      console.error(`   알 수 없는 오류:`, error);
    }
  }

  // 3. 네트워크 인터페이스 확인
  console.log();
  console.log('[테스트 3] 네트워크 인터페이스 확인...');
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  console.log('   네트워크 인터페이스:');
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    if (Array.isArray(interfaces)) {
      for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`   - ${name}: ${iface.address}`);
        }
      }
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log('테스트 완료');
  console.log('='.repeat(60));
}

testServerConnection().catch((error) => {
  console.error('테스트 실행 중 오류:', error);
  process.exit(1);
});

