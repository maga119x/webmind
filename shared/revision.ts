export function isLegacyDriveRevision(value: string): boolean {
  try {
    const parts = JSON.parse(value);
    return (
      Array.isArray(parts) &&
      parts.length === 2 &&
      typeof parts[0] === "string" &&
      /^\d+$/.test(parts[0]) &&
      typeof parts[1] === "string"
    );
  } catch {
    return false;
  }
}
