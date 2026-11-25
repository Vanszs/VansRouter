// Auth modes a provider accepts. Declared by the registry entry; the legacy
// "api_key" spelling is normalized at the connection filter (expandAuthTypes).
export function getProviderAuthTypes(provider) {
  if (Array.isArray(provider?.authModes) && provider.authModes.length > 0) {
    return provider.authModes;
  }
  return provider?.hasOAuth ? ["oauth"] : ["apikey"];
}
