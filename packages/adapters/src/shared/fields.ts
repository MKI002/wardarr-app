// Common credential fields and schemas.
import type { CredentialField } from '@wardarr/core';
import { z } from 'zod';

export const apiKeyField: CredentialField = {
  key: 'apiKey',
  kind: 'secret',
  label: 'adapters.fields.apiKey',
  help: 'adapters.help.apiKeyArr',
  required: true,
};

export const usernameField = (required: boolean): CredentialField => ({
  key: 'username',
  kind: 'text',
  label: 'adapters.fields.username',
  required,
});

export const passwordField = (required: boolean): CredentialField => ({
  key: 'password',
  kind: 'secret',
  label: 'adapters.fields.password',
  required,
});

export const apiKeySchema = z.object({ apiKey: z.string().trim().min(1).max(256) });
