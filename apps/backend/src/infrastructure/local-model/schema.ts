import { z } from 'zod';
import { AiError } from '../../domains/shared/ports/ai-execution';

/** Grammar assists generation; actual Zod and domain validation remain authoritative. */
export function localJsonSchema(schema: z.ZodType): any {
  let json: object;
  try {
    json = z.toJSONSchema(schema, {
      target: 'draft-7', io: 'input', unrepresentable: 'throw', reused: 'inline', cycles: 'throw',
      override({ zodSchema, jsonSchema }) {
        // The schema owner documents the input of its otherwise-unrepresentable preprocess.
        const input = z.globalRegistry.get(zodSchema)?.aiJsonInput;
        if (zodSchema._zod.def.type === 'pipe' && zodSchema._zod.def.in._zod.def.type === 'transform' && !input) {
          throw new AiError('unsupported');
        }
        if (input) {
          for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
          Object.assign(jsonSchema, input);
        }
      },
    });
  } catch { throw new AiError('unsupported'); }
  if (Buffer.byteLength(JSON.stringify(json)) > 32 * 1024) throw new AiError('input_limit');
  return json;
}
