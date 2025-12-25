import { IsArray, IsOptional, IsString, Allow } from 'class-validator';

/**
 * DTO for OAuth Dynamic Client Registration request
 * Based on RFC 7591: https://datatracker.ietf.org/doc/html/rfc7591
 *
 * IMPORTANT: This DTO is intentionally permissive.
 *
 * MCP clients (Claude, ChatGPT, etc.) have varying implementations:
 * - Some send `redirect_uris` (plural, per RFC)
 * - Some send `redirect_uri` (singular)
 * - Some send arrays, some send strings
 *
 * We accept whatever they send and normalize it in the controller.
 * The real validation is the redirect_uri allowlist check, not input format.
 *
 * If you need to tighten validation later, add decorators here - but be
 * prepared to test with all MCP clients to ensure compatibility.
 */
export class RegisterClientDto {
  /**
   * Redirect URIs (RFC 7591 standard field - plural, array)
   * Made optional because some clients use singular form instead.
   */
  @IsOptional()
  @Allow()
  redirect_uris?: string[] | string;

  /**
   * Redirect URI (non-standard singular form)
   * Some MCP clients send this instead of redirect_uris.
   */
  @IsOptional()
  @Allow()
  redirect_uri?: string[] | string;

  @IsOptional()
  @IsString()
  client_name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grant_types?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  response_types?: string[];

  @IsOptional()
  @IsString()
  token_endpoint_auth_method?: string;
}
