import { NextRequest } from "next/server";
import { getAuthUrl } from "@/lib/google-auth";

export async function GET(_request: NextRequest) {
  try {
    const url = getAuthUrl();
    return Response.redirect(url);
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
