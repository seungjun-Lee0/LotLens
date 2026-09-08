// DELETE /api/report/[id] — remove one report run from "My reports".
//
// Owner-only (admins may delete any). Only the `reports` row goes; the
// address + council_data stay because other runs and other users hang
// off them (see deleteUserReport).

import { NextResponse } from "next/server";

import { getSessionUser, isAdmin } from "@/lib/auth";
import { deleteUserReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid report id" }, { status: 400 });
  }
  const deleted = await deleteUserReport(id, user.id, isAdmin(user));
  if (!deleted) {
    // Same answer for "not yours" and "doesn't exist": no ownership probe.
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
