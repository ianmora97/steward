declare module '*.png' {
  const url: string;
  export default url;
}

declare module '*.md?raw' {
  const source: string;
  export default source;
}
