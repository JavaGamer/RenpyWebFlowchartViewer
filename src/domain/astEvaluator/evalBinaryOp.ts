export function applySingleBinaryOp(
  op: string,
  lv: unknown,
  rv: unknown,
): { value: unknown; ok: boolean } {
  if (op === "+") {
    if (typeof lv === "string" || typeof rv === "string") {
      return { value: String(lv) + String(rv), ok: true };
    }
    const num = (lv as number) + (rv as number);
    return { value: num, ok: !isNaN(num) };
  }
  if (op === "-") {
    const num = (lv as number) - (rv as number);
    return { value: num, ok: !isNaN(num) };
  }
  if (op === "*") {
    if (
      typeof lv === "string" &&
      typeof rv === "number" &&
      Number.isInteger(rv) &&
      rv >= 0
    ) {
      return { value: lv.repeat(Math.min(rv, 1000)), ok: true };
    }
    if (
      typeof rv === "string" &&
      typeof lv === "number" &&
      Number.isInteger(lv) &&
      lv >= 0
    ) {
      return { value: rv.repeat(Math.min(lv, 1000)), ok: true };
    }
    const num = (lv as number) * (rv as number);
    return { value: num, ok: !isNaN(num) };
  }
  if (op === "/") {
    return {
      value: (rv as number) !== 0 ? (lv as number) / (rv as number) : undefined,
      ok: (rv as number) !== 0,
    };
  }
  if (op === "%") {
    return {
      value: (rv as number) !== 0 ? (lv as number) % (rv as number) : undefined,
      ok: (rv as number) !== 0,
    };
  }
  if (op === "//") {
    return {
      value: (rv as number) !== 0
        ? Math.floor((lv as number) / (rv as number))
        : undefined,
      ok: (rv as number) !== 0,
    };
  }
  if (op === "**") {
    return {
      value: Math.pow(lv as number, rv as number),
      ok: true,
    };
  }
  if (op === "==") return { value: lv === rv, ok: true };
  if (op === "!=") return { value: lv !== rv, ok: true };
  if (op === "<") return { value: (lv as number) < (rv as number), ok: true };
  if (op === ">") return { value: (lv as number) > (rv as number), ok: true };
  if (op === "<=") return { value: (lv as number) <= (rv as number), ok: true };
  if (op === ">=") return { value: (lv as number) >= (rv as number), ok: true };
  if (op === "is") return { value: lv === rv, ok: true };
  if (op === "is not") return { value: lv !== rv, ok: true };
  if (op === "in" || op === "not in") {
    let contained = false;
    if (Array.isArray(rv)) {
      contained = rv.includes(lv);
    } else if (typeof rv === "string") {
      contained = rv.includes(String(lv));
    } else if (typeof rv === "object" && rv !== null) {
      const obj = rv as
        | Set<unknown>
        | Map<unknown, unknown>
        | Record<string, unknown>;
      if (obj instanceof Set) {
        contained = obj.has(lv);
      } else if (obj instanceof Map) {
        contained = obj.has(String(lv));
      } else {
        contained = Object.prototype.hasOwnProperty.call(
          obj,
          String(lv),
        );
      }
    }
    const val = op === "in" ? contained : !contained;
    return { value: val, ok: true };
  }
  if (op === "&") {
    return {
      value: (lv as number) & (rv as number),
      ok: true,
    };
  }
  if (op === "|") {
    return {
      value: (lv as number) | (rv as number),
      ok: true,
    };
  }
  if (op === "^") {
    return {
      value: (lv as number) ^ (rv as number),
      ok: true,
    };
  }
  if (op === "<<") {
    return {
      value: (lv as number) << (rv as number),
      ok: true,
    };
  }
  if (op === ">>") {
    return {
      value: (lv as number) >> (rv as number),
      ok: true,
    };
  }
  return { value: undefined, ok: false };
}
