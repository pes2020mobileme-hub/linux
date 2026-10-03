import type { Client } from "discord.js";

export type GuildPick={ ok:true; id:string; how:string } | { ok:false; reason:string };

export function pickGuildId(client:Client):GuildPick{
 const env=process.env.GUILD_ID;
 if(env) return {ok:true,id:env,how:"ตั้ง GUILD_ID ไว้"};
 const ids=[...client.guilds.cache.keys()];
 if(ids.length===1) return {ok:true,id:ids[0],how:"server เดียวที่บอทอยู่ (หาเอง)"};
 if(ids.length===0) return {ok:false,reason:"บอทไม่ได้อยู่ใน server ใดเลย — ต้องเชิญบอทเข้า server ก่อน"};
 return {ok:false,reason:`บอทอยู่ ${ids.length} server (${ids.join(", ")}) — ต้องตั้ง GUILD_ID ให้ชัดเจนว่าใช้ server ไหน`};
}