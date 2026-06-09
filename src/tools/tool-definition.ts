import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Db } from '../db.js';

/**
 * A tool's complete self-description: everything `server.ts` needs to advertise
 * it (`tools/list`) and dispatch it (`tools/call`) generically. Each tool module
 * exports one of these via {@link defineTool}; the server holds the registry and
 * a single generic handler, so adding a tool touches the registry in one line
 * instead of duplicating advertise + dispatch boilerplate.
 *
 * The advertised JSON schemas are precomputed by {@link defineTool} (where the
 * input/output types are concrete), so the server never re-derives them.
 * `outputJsonSchema` wraps the result under {@link structuredKey} as an object
 * (MCP requires an object root); the dispatcher returns the run result under
 * that same key as `structuredContent`. `inputSchema` is retained as a Zod
 * schema for runtime `safeParse` at dispatch.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly inputJsonSchema: Record<string, unknown>;
  readonly outputJsonSchema: Record<string, unknown>;
  readonly structuredKey: string;
  run(args: unknown, db: Db): Promise<unknown>;
}

/**
 * Build a {@link ToolDefinition} while preserving the tool's own input/output
 * types on `run`. The server parses `args` with `inputSchema` before invoking
 * `run`, so the internal `args as I` narrowing is sound.
 */
export function defineTool<I, O>(definition: {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  structuredKey: string;
  run: (args: I, db: Db) => Promise<O>;
}): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    inputJsonSchema: zodToJsonSchema(definition.inputSchema, { target: 'jsonSchema7' }),
    outputJsonSchema: zodToJsonSchema(
      z.object({ [definition.structuredKey]: definition.outputSchema }),
      { target: 'jsonSchema7' },
    ),
    structuredKey: definition.structuredKey,
    run: (args, db) => definition.run(args as I, db),
  };
}
