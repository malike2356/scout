declare module 'yamljs' {
  const YAML: {
    load: (path: string) => unknown;
    parse: (input: string) => unknown;
    stringify: (obj: unknown, inline?: number, spaces?: number) => string;
  };
  export default YAML;
}
