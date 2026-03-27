import { NextRequest } from "next/server";
import { getAuthUrl } from "@/lib/google-auth";

export async function GET(request: NextRequest) {
  try {
    const origin = request.nextUrl.origin;
    const url = getAuthUrl(origin);
    return Response.redirect(url);
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
