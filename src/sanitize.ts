const VALID_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

export function sanitizeKey(key: string): string {
  if (VALID_KEY.test(key)) return key;
  return key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64) || '_';
}

export function sanitizeSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return walkSchema(structuredClone(schema));
}

function walkSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.properties && typeof schema.properties === 'object') {
    const orig = schema.properties as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    const keyMap = new Map<string, string>();
    const usedKeys = new Set<string>();

    for (const [key, value] of Object.entries(orig)) {
      let newKey = sanitizeKey(key);
      if (usedKeys.has(newKey)) {
        let i = 2;
        while (usedKeys.has(`${newKey}_${i}`)) i++;
        newKey = `${newKey}_${i}`;
      }
      usedKeys.add(newKey);
      keyMap.set(key, newKey);

      sanitized[newKey] =
        typeof value === 'object' && value !== null
          ? walkSchema(value as Record<string, unknown>)
          : value;
    }
    schema.properties = sanitized;

    if (Array.isArray(schema.required)) {
      schema.required = (schema.required as string[]).map(
        (k) => keyMap.get(k) ?? sanitizeKey(k),
      );
    }
  }

  if (schema.items && typeof schema.items === 'object') {
    schema.items = walkSchema(schema.items as Record<string, unknown>);
  }

  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      schema[key] = (schema[key] as Record<string, unknown>[]).map((s) =>
        walkSchema(s),
      );
    }
  }

  if (
    typeof schema.additionalProperties === 'object' &&
    schema.additionalProperties !== null
  ) {
    schema.additionalProperties = walkSchema(
      schema.additionalProperties as Record<string, unknown>,
    );
  }

  return schema;
}

export function restoreKeys(
  data: unknown,
  originalSchema: Record<string, unknown> | undefined,
): unknown {
  if (Array.isArray(data)) {
    const itemSchema = originalSchema?.items as
      | Record<string, unknown>
      | undefined;
    return itemSchema ? data.map((item) => restoreKeys(item, itemSchema)) : data;
  }

  if (!originalSchema || typeof data !== 'object' || data === null) {
    return data;
  }

  const origProps = originalSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!origProps) return data;

  const reverseMap = new Map<string, string>();
  const usedKeys = new Set<string>();

  for (const key of Object.keys(origProps)) {
    let newKey = sanitizeKey(key);
    if (usedKeys.has(newKey)) {
      let i = 2;
      while (usedKeys.has(`${newKey}_${i}`)) i++;
      newKey = `${newKey}_${i}`;
    }
    usedKeys.add(newKey);
    reverseMap.set(newKey, key);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    data as Record<string, unknown>,
  )) {
    const originalKey = reverseMap.get(key) ?? key;
    const propSchema = origProps[originalKey];
    result[originalKey] = restoreKeys(value, propSchema);
  }

  return result;
}
