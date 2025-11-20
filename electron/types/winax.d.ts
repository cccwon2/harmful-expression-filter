/**
 * winax 타입 정의
 * 
 * winax는 Windows COM 객체를 Node.js에서 사용하기 위한 라이브러리입니다.
 */

declare module 'winax' {
  export class Object {
    constructor(progId: string);
    [key: string]: any;
  }

  export function getConnectionPoints(obj: any): Array<{
    advise: (sink: any) => number;
    unadvise?: (cookie: number) => void;
    [key: string]: any;
  }>;

  export function peekAndDispatchMessages(): void;
  export function release(obj: any): void;
}

