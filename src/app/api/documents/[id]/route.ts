import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { documents } from "@/db/schema";
const SECRET=new TextEncoder().encode(process.env.JWT_SECRET||"change-this-to-random-64-char-string");
async function uid(r:NextRequest){const t=r.cookies.get("access_token")?.value;if(!t)return null;try{const {payload}=await jwtVerify(t,SECRET);return payload.userId as string}catch{return null}}
export async function DELETE(r:NextRequest,{params}:{params:Promise<{id:string}>}){const userId=await uid(r);if(!userId)return NextResponse.json({error:"غیر مجاز"},{status:401});const {id}=await params;const [x]=await db.delete(documents).where(and(eq(documents.id,id),eq(documents.ownerId,userId))).returning({id:documents.id});if(!x)return NextResponse.json({error:"سند یافت نشد"},{status:404});return NextResponse.json({success:true,id:x.id})}
