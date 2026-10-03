import crypto from "node:crypto";
import type { Db } from "../database/index.js";

export type GiveawayRequirements={ minAccountAgeDays?:number; roleIds?:string[] };

export type Giveaway={
 id:string; guildId:string; channelId:string|null; title:string; winners:number;
 requirements:GiveawayRequirements; endsAt:string; createdBy:string; createdAt:string; drawn:boolean;
};

export type EntryResult={ ok:boolean; reason:string; entries?:number };

const now=()=>new Date().toISOString();

function toGiveaway(r:Record<string,unknown>):Giveaway{
 return {
  id:String(r.id),guildId:String(r.guild_id),channelId:r.channel_id?String(r.channel_id):null,
  title:String(r.title),winners:Number(r.winners),
  requirements:JSON.parse(String(r.requirements)) as GiveawayRequirements,
  endsAt:String(r.ends_at),createdBy:String(r.created_by),createdAt:String(r.created_at),drawn:Number(r.drawn)===1
 };
}

export type CreateGiveawayInput={ guildId:string; channelId?:string|null; title:string; winners:number; durationSec:number; requirements?:GiveawayRequirements; createdBy:string };

export function createGiveaway(db:Db,input:CreateGiveawayInput):Giveaway{
 if(!input.title.trim()) throw new Error("ต้องระบุชื่อรางวัล");
 if(!Number.isInteger(input.winners)||input.winners<1) throw new Error("winners ต้องเป็นจำนวนเต็มที่มากกว่า 0");
 if(!Number.isInteger(input.durationSec)||input.durationSec<=0) throw new Error("durationSec ต้องเป็นจำนวนเต็มมากกว่า 0");
 const req=input.requirements??{};
 if(req.minAccountAgeDays!==undefined&&(!Number.isInteger(req.minAccountAgeDays)||req.minAccountAgeDays<0)) throw new Error("minAccountAgeDays ต้องเป็นจำนวนเต็มที่ไม่ติดลบ");
 const id=crypto.randomUUID();
 const endsAt=new Date(Date.now()+input.durationSec*1000).toISOString();
 const createdAt=now();
 db.prepare("INSERT INTO giveaways (id, guild_id, channel_id, title, winners, requirements, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
  .run(id,input.guildId,input.channelId??null,input.title.trim(),input.winners,JSON.stringify(req),endsAt,input.createdBy,createdAt);
 return {id,guildId:input.guildId,channelId:input.channelId??null,title:input.title.trim(),winners:input.winners,requirements:req,endsAt,createdBy:input.createdBy,createdAt,drawn:false};
}

export function getGiveaway(db:Db,id:string){
 const row=db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id) as Record<string,unknown>|undefined;
 return row?toGiveaway(row):null;
}

export type Entrant={ userId:string; accountCreatedAt:string; roleIds:string[] };

export function enter(db:Db,giveawayId:string,entrant:Entrant,at=Date.now()):EntryResult{
 const g=getGiveaway(db,giveawayId);
 if(!g) return {ok:false,reason:"ไม่พบรางวัลนี้"};
 if(g.drawn) return {ok:false,reason:"สุ่มผู้ชนะไปแล้ว"};
 if(Date.parse(g.endsAt)<=at) return {ok:false,reason:"รางวัลหมดเวลาแล้ว"};
 const minAge=g.requirements.minAccountAgeDays;
 if(minAge!==undefined){
  const created=Date.parse(entrant.accountCreatedAt);
  if(Number.isNaN(created)) return {ok:false,reason:"ข้อมูลวันที่สร้างบัญชีไม่ถูกต้อง"};
  const ageDays=(at-created)/86400000;
  if(ageDays<minAge) return {ok:false,reason:`บัญชีต้องมีอายุอย่างน้อย ${minAge} วัน (ตอนนี้ ${Math.floor(ageDays)} วัน)`};
 }
 const needRoles=g.requirements.roleIds??[];
 if(needRoles.length&&!needRoles.some(r=>entrant.roleIds.includes(r))) return {ok:false,reason:"ต้องมี role ที่กำหนดจึงจะเข้าร่วมได้"};
 const exists=db.prepare("SELECT 1 AS x FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?").get(giveawayId,entrant.userId);
 if(exists) return {ok:false,reason:"เข้าร่วมไปแล้ว"};
 db.prepare("INSERT INTO giveaway_entries (giveaway_id, user_id, created_at) VALUES (?, ?, ?)").run(giveawayId,entrant.userId,now());
 return {ok:true,reason:"เข้าร่วมแล้ว",entries:entryCount(db,giveawayId)};
}

export function entryCount(db:Db,giveawayId:string){
 return Number((db.prepare("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?").get(giveawayId) as {n:number}).n);
}

export function participants(db:Db,giveawayId:string){
 return db.prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY created_at ASC").all(giveawayId)
  .map(r=>String((r as Record<string,unknown>).user_id));
}

export function randomInt(maxExclusive:number){
 if(!Number.isInteger(maxExclusive)||maxExclusive<=0) throw new Error("randomInt ต้องได้ค่ามากกว่า 0");
 return crypto.randomInt(maxExclusive);
}

export function drawWinners(db:Db,giveawayId:string){
 const g=getGiveaway(db,giveawayId);
 if(!g) throw new Error("ไม่พบรางวัลนี้");
 if(g.drawn) throw new Error("สุ่มผู้ชนะไปแล้ว");
 const pool=participants(db,giveawayId);
 if(!pool.length) throw new Error("ไม่มีผู้เข้าร่วม");
 const wanted=Math.min(g.winners,pool.length);
 const picked=new Set<string>();
 let guard=0;
 while(picked.size<wanted&&guard<1000){
  picked.add(pool[randomInt(pool.length)]);
  guard++;
 }
 db.prepare("UPDATE giveaways SET drawn = 1 WHERE id = ?").run(giveawayId);
 return {giveawayId,requested:g.winners,participants:pool.length,winners:[...picked]};
}

export function listGiveaways(db:Db,guildId:string,limit=20){
 return db.prepare("SELECT * FROM giveaways WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId,limit).map(r=>toGiveaway(r as Record<string,unknown>));
}
