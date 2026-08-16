export const ROLE_LABELS = {
  admin: "Owner / Admin",
  manager: "Project Manager",
  field: "Field Worker / Crew",
  member: "Project Manager",
};

export function normalizeRole(role) {
  const raw = String(role || "").toLowerCase();
  if (raw === "admin" || raw === "owner") return "admin";
  if (raw === "field" || raw === "crew" || raw === "worker") return "field";
  return "manager";
}

export function can(user, feature) {
  if (!user) return false;
  if (normalizeRole(user.role) === "admin") return true;
  return Boolean(user.permissions?.[feature]);
}

export function isFieldOnly(user) {
  return normalizeRole(user?.role) === "field";
}
