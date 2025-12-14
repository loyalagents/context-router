import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * DTO for OAuth Dynamic Client Registration request
 * Based on RFC 7591: https://datatracker.ietf.org/doc/html/rfc7591
 *
 * Our DCR shim only uses redirect_uris - other fields are accepted
 * but largely ignored since we return a static client_id.
 */
export class RegisterClientDto {
  @IsArray()
  @IsString({ each: true })
  redirect_uris: string[];

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
