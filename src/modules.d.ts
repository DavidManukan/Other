declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.woff2" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.css" {
  const text: string;
  export default text;
}
