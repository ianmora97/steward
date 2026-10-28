// electron-vite copies the file next to the bundle and returns its runtime path.
declare module '*.png?asset' {
  const path: string;
  export default path;
}
