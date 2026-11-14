import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { listUsers } from './auth.js';
import { getEvent, getEventsBetween, saveEvent } from './db.js';
import { sanitizeEvent } from './events.js';

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

/** ISO 8601 → ms. Sans fuseau, l'heure est interprétée dans le fuseau du serveur (TZ). */
const toMs = (iso) => Date.parse(iso);
const isoDate = z.string().refine((s) => Number.isFinite(toMs(s)), 'Date ISO 8601 invalide');

const eventFields = {
  title: z.string().describe("Titre de l'évènement"),
  startsAt: isoDate.describe('Début (ISO 8601, ex. 2026-11-20T14:00:00+01:00)'),
  endsAt: isoDate.describe('Fin (ISO 8601), postérieure ou égale au début'),
  location: z.string().optional(),
  notes: z.string().optional(),
  allDay: z.boolean().optional(),
  attendees: z.array(z.string()).optional().describe("Identifiants des participants (cf. list_users)"),
  reminders: z.array(z.number().int()).optional().describe("Rappels en minutes avant le début"),
  color: z.string().optional().describe('Couleur hexadécimale #rrggbb'),
};

const view = (e) => ({
  ...e,
  startsAt: new Date(e.startsAt).toISOString(),
  endsAt: new Date(e.endsAt).toISOString(),
});

const canEdit = (event, user) => event.ownerId === user.id || event.attendees.includes(user.id);

/** Construit un serveur MCP lié à l'utilisateur authentifié (une instance par requête). */
function buildServer(user) {
  const server = new McpServer({ name: 'familyagenda', version: '0.1.0' });
  const validIds = () => new Set(listUsers().map((u) => u.id));

  server.registerTool(
    'list_users',
    { description: "Liste les membres de l'agenda partagé (id, nom, couleur)", inputSchema: z.object({}) },
    async () => text(listUsers()),
  );

  server.registerTool(
    'list_events',
    {
      description: 'Liste les évènements qui chevauchent une période',
      inputSchema: z.object({
        from: isoDate.describe('Début de la période (ISO 8601)'),
        to: isoDate.describe('Fin de la période (ISO 8601)'),
      }),
    },
    async ({ from, to }) => text(getEventsBetween(toMs(from), toMs(to)).map(view)),
  );

  server.registerTool(
    'create_event',
    { description: 'Crée un évènement (le propriétaire est l’utilisateur connecté)', inputSchema: z.object(eventFields) },
    async (args) => {
      const ev = sanitizeEvent(
        { ...args, id: randomUUID(), startsAt: toMs(args.startsAt), endsAt: toMs(args.endsAt) },
        validIds(),
      );
      if (!ev) return fail('Évènement invalide (titre vide ou fin avant le début)');
      return text(view(saveEvent(ev, user.id)));
    },
  );

  server.registerTool(
    'update_event',
    {
      description: 'Modifie un évènement dont on est propriétaire ou participant (seuls les champs fournis changent)',
      inputSchema: z.object({ id: z.string(), ...Object.fromEntries(Object.entries(eventFields).map(([k, v]) => [k, v.optional()])) }),
    },
    async ({ id, ...changes }) => {
      const existing = getEvent(id);
      if (!existing || existing.deleted) return fail('Évènement introuvable');
      if (!canEdit(existing, user)) return fail('Modification non autorisée');
      const merged = { ...existing };
      for (const [k, v] of Object.entries(changes)) if (v !== undefined) merged[k] = v;
      if (changes.startsAt !== undefined) merged.startsAt = toMs(changes.startsAt);
      if (changes.endsAt !== undefined) merged.endsAt = toMs(changes.endsAt);
      const ev = sanitizeEvent(merged, validIds());
      if (!ev) return fail('Évènement invalide (titre vide ou fin avant le début)');
      return text(view(saveEvent(ev, user.id)));
    },
  );

  server.registerTool(
    'delete_event',
    {
      description: 'Supprime un évènement dont on est propriétaire ou participant',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      const existing = getEvent(id);
      if (!existing || existing.deleted) return fail('Évènement introuvable');
      if (!canEdit(existing, user)) return fail('Suppression non autorisée');
      saveEvent({ ...existing, deleted: true }, user.id);
      return text({ ok: true });
    },
  );

  return server;
}

/** Route Express `/mcp` (après requireAuth). Mode sans état : un serveur et un transport par requête. */
export async function mcpRoute(req, res) {
  const server = buildServer(req.user);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Erreur MCP' });
  }
}
