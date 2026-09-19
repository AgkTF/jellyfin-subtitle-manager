export function resolveApiPort(value: string | undefined): number {
  const requestedPort = Number.parseInt(value ?? "", 10);
  return Number.isInteger(requestedPort) ? requestedPort : 3000;
}
