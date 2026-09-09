export function readValue(input: Record<string, string>, key: string) {
  return Reflect.get(input, key);
}
