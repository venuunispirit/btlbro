import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

export async function getUser(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token) return null;
  return { id: token.id as string, role: token.role as string };
}
