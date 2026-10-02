// Who is acting. There is no authentication in the prototype yet, so every
// staff action is attributed to one demo user in the audit log.
// ASSUMPTION / TODO: replace with the signed-in user before any real use;
// GoBD traceability requires knowing the actual person.
export function currentActor(): string {
  return "staff:demo";
}
