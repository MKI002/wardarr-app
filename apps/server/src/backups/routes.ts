// Backups of Wardarr's own data. Admin only (the default access).
import { RETENTION_LEVELS, type RetentionLevel } from '@wardarr/core';
import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import { HttpError, parse } from '../http/validate.js';
import type { BackupService } from './service.js';

/** Largest backup that can be uploaded. */
export const UPLOAD_LIMIT = 512 * 1024 * 1024;

const level = z
  .number()
  .int()
  .refine((n) => (RETENTION_LEVELS as readonly number[]).includes(n));
const passphrase = z.string().min(10).max(1024);

export function registerBackupRoutes(
  app: FastifyInstance,
  deps: { backups: BackupService; restart?: () => void },
): void {
  const { backups } = deps;

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT },
    (_req, body, done) => done(null, body),
  );

  app.get('/api/backups', async () => backups.overview());

  app.put('/api/backups/settings', async (req) => {
    const body = parse(z.object({ level }).strict(), req.body ?? {});
    await backups.setLevel(body.level as RetentionLevel);
    return backups.overview();
  });

  app.post('/api/backups', async (req, reply) => reply.code(201).send(await backups.create('manual')));

  app.post('/api/backups/upload', { bodyLimit: UPLOAD_LIMIT }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'notABackup');
    return reply.code(201).send(await backups.importUpload(req.body));
  });

  app.put<{ Params: { id: string } }>('/api/backups/:id/pin', async (req) => {
    const body = parse(z.object({ pinned: z.boolean() }).strict(), req.body ?? {});
    backups.setPinned(req.params.id, body.pinned);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/backups/:id', async (req) => {
    await backups.remove(req.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/backups/:id/download', async (req, reply) => {
    const file = backups.file(req.params.id);
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${req.params.id}.wbak"`);
    reply.header('cache-control', 'no-store');
    return reply.send(createReadStream(file));
  });

  app.post<{ Params: { id: string } }>('/api/backups/:id/export', async (req, reply) => {
    const body = parse(z.object({ passphrase }).strict(), req.body ?? {});
    const out = await backups.exportProtected(req.params.id, body.passphrase);
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="${out.name}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(out.data);
  });

  app.post<{ Params: { id: string } }>('/api/backups/:id/restore', async (req) => {
    const body = parse(
      z
        .object({
          passphrase: z.string().max(1024).optional(),
          acceptKeyMismatch: z.boolean().optional(),
        })
        .strict(),
      req.body ?? {},
    );
    if (!deps.restart) throw new HttpError(409, 'restartUnavailable');
    const summary = await backups.stageRestore(req.params.id, body);
    // Answer first, then restart with the restored database.
    const restart = deps.restart;
    setTimeout(restart, 250).unref();
    return { ...summary, restarting: true };
  });
}
