declare global {
  interface Window {
    api: {
      appVersion: string;
      getVersion: () => string;
    };
  }
}

