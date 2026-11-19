export const MAX_SESSION_BUILTIN_CAPABILITIES = 32;

export function sessionBuiltinCapabilitiesSettingKey(sessionId: string): string {
  return `session.builtinCapabilities.v1.${sessionId}`;
}
