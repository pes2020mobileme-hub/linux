import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type ApiScope="health"|"guilds"|"announce"|"moderation"|"ai"|"webhooks";

export const ALL_SCOPES:ApiScope[]=["health","guilds","announce","moderation","ai","webhooks"];

export type CreatedApiKey={ id:string; plaintext:string; prefix:string; scopes:ApiScope[]; createdAt:string; expiresAt:string|null };

export type ApiKeyRecord={
 id:string; name:string; prefix:string; scopes:ApiScope[]; guildId:string|null;
 createdAt:string; expiresAt:string|null; lastUsedAt:string|null; revokedAt:string|null;
};

export function hashKey(plaintext:string){
 return crypto.createHash("sha256").update(plaintext,"utf8").digest("hex");
}

export function generateApiKey(scopes:ApiScope[]=["health"],expiresInDays:number|null=null,prefix="dh_live"):CreatedApiKey{
 const body=crypto.randomBytes(24).toString("base64url");
 const plaintext=`${prefix}_${body}`;
 return {
  id:crypto.randomUUID(),
  plaintext,
  prefix:plaintext.slice(0,prefix.length+5),
  scopes,
  createdAt:new Date().toISOString(),
  expiresAt:expiresInDays?new Date(Date.now()+expiresInDays*86400000).toISOString():null
 };
}

export function verifyApiKey(plaintext:string,hash:string){
 const a=Buffer.from(hashKey(plaintext),"hex");
 const b=Buffer.from(hash,"hex");
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}

export function createApiKey(db:Db,created:CreatedApiKey,name:string,guildId:string|null=null){
 db.prepare("INSERT INTO api_keys (id, name, hash, prefix, scopes, guild_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  .run(created.id,name,hashKey(created.plaintext),created.prefix,created.scopes.join(","),guildId,created.createdAt,created.expiresAt);
 return created;
}

function toRecord(row:Record<string,unknown>):ApiKeyRecord{
 return {
  id:String(row.id),name:String(row.name),prefix:String(row.prefix),
  scopes:String(row.scopes).split(",").filter(Boolean) as ApiScope[],
  guildId:row.guild_id?String(row.guild_id):null,
  createdAt:String(row.created_at),
  expiresAt:row.expires_at?String(row.expires_at):null,
  lastUsedAt:row.last_used_at?String(row.last_used_at):null,
  revokedAt:row.revoked_at?String(row.revoked_at):null
 };
}

export function findApiKeyByHash(db:Db,hash:string){
 const row=db.prepare("SELECT * FROM api_keys WHERE hash = ?").get(hash) as Record<string,unknown>|undefined;
 return row?toRecord(row):null;
}

export type VerifyResult={ ok:boolean; reason:string; key?:ApiKeyRecord };

export function authenticateApiKey(db:Db,plaintext:string,scope:ApiScope,now=Date.now()):VerifyResult{
 const record=findApiKeyByHash(db,hashKey(plaintext));
 if(!record) return {ok:false,reason:"ไม่พบ API key"};
 if(record.revokedAt) return {ok:false,reason:"API key ถูกเพิกถอนแล้ว"};
 if(record.expiresAt&&Date.parse(record.expiresAt)<=now) return {ok:false,reason:"API key หมดอายุแล้ว"};
 if(!record.scopes.includes(scope)) return {ok:false,reason:`API key นี้ไม่มีสิทธิ์ ${scope}`};
 db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date(now).toISOString(),record.id);
 return {ok:true,reason:"ใช้งานได้",key:{...record,lastUsedAt:new Date(now).toISOString()}};
}

export function revokeApiKey(db:Db,id:string){
 db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(new Date().toISOString(),id);
}

export function listApiKeys(db:Db){
 return db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all().map(r=>toRecord(r as Record<string,unknown>));
}

export function rotateApiKey(db:Db,id:string,scopes:ApiScope[],expiresInDays:number|null=null){
 const next=generateApiKey(scopes,expiresInDays);
 db.prepare("UPDATE api_keys SET hash = ?, prefix = ?, scopes = ?, expires_at = ?, created_at = ?, last_used_at = NULL, revoked_at = NULL WHERE id = ?")
  .run(hashKey(next.plaintext),next.prefix,next.scopes.join(","),next.expiresAt,next.createdAt,id);
 return {...next,id};
}

export function publicView(k:ApiKeyRecord){
 return {id:k.id,name:k.name,prefix:k.prefix,scopes:k.scopes,createdAt:k.createdAt,expiresAt:k.expiresAt,lastUsedAt:k.lastUsedAt,revokedAt:k.revokedAt};
}